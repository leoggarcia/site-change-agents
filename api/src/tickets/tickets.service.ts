import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import type { EntityManager, FindOptionsWhere } from 'typeorm';
import { SitesService } from '../sites/sites.service.js';
import type { User } from '../users/user.entity.js';
import type { CreateTicketDto } from './dto/create-ticket.dto.js';
import { TicketEvent } from './ticket-event.entity.js';
import { canTransition, SITE_BUSY_STATUSES, TICKET_TRANSITIONS } from './ticket-status.js';
import type { TicketStatus } from './ticket-status.js';
import { Ticket } from './ticket.entity.js';
import type { PendingQuestion } from './ticket.entity.js';
import { toTicketEventView, toTicketView } from './ticket.views.js';
import type { TicketDetailView, TicketView } from './ticket.views.js';

/** Who made a change: a person in the panel, an agent ("intake", "coder", ...) or the system itself. */
export type Actor = { type: 'user'; user: User } | { type: 'agent'; agent: string } | { type: 'system' };

export interface StatusChangeOptions {
  fields?: Partial<Pick<Ticket, 'summary' | 'changeType' | 'target' | 'details' | 'acceptanceCriteria' | 'risk'>>;
  data?: Record<string, unknown>;
  onlyFrom?: TicketStatus;
}

function actorColumns(actor: Actor): Pick<TicketEvent, 'actorType' | 'actorUserId' | 'actorAgent'> {
  return {
    actorType: actor.type,
    actorUserId: actor.type === 'user' ? actor.user.id : null,
    actorAgent: actor.type === 'agent' ? actor.agent : null,
  };
}

@Injectable()
export class TicketsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectRepository(TicketEvent) private readonly events: Repository<TicketEvent>,
    private readonly sitesService: SitesService,
  ) {}

  async create(user: User, dto: CreateTicketDto): Promise<TicketView> {
    const site = await this.sitesService.getAccessible(user, dto.siteId);

    const ticketId = await this.dataSource.transaction(async (manager) => {
      const ticket = await manager.save(
        manager.create(Ticket, { siteId: site.id, createdById: user.id, request: dto.request, status: 'intake' }),
      );
      await this.addEvent(manager, ticket.id, { type: 'user', user }, 'created', 'Request received.', {
        toStatus: 'intake',
      });
      return ticket.id;
    });

    return toTicketView(await this.findWithRelations(ticketId));
  }

  async list(user: User, status?: TicketStatus): Promise<TicketView[]> {
    const where: FindOptionsWhere<Ticket> = {};
    if (status) where.status = status;
    if (user.role !== 'agency') where.site = { clientId: user.clientId! };

    const tickets = await this.tickets.find({
      where,
      relations: { site: true, createdBy: true },
      order: { updatedAt: 'DESC' },
    });
    return tickets.map(toTicketView);
  }

  async get(user: User, id: number): Promise<TicketDetailView> {
    const ticket = await this.findWithRelations(id);
    if (user.role !== 'agency' && ticket.site.clientId !== user.clientId) {
      // Same answer as a missing ticket, so clients can't probe other clients' ticket ids.
      throw new NotFoundException(`Ticket ${id} not found.`);
    }

    const events = await this.events.find({
      where: { ticketId: id },
      relations: { actorUser: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    return {
      ...toTicketView(ticket),
      events: events.map((event) => toTicketEventView(event, user.role === 'agency')),
      allowedTransitions: user.role === 'agency' ? [...TICKET_TRANSITIONS[ticket.status]] : [],
    };
  }

  /**
   * The only way a ticket's status changes. Validates the transition and records it in the audit trail.
   * `fields` (e.g. the Intake Agent's structured ticket) are saved in the same transaction.
   * With `onlyFrom`, nothing happens (and it returns false) if the ticket has already left that status:
   * a slow agent must not override what a person did in the meantime.
   */
  async changeStatus(id: number, to: TicketStatus, actor: Actor, message?: string, options: StatusChangeOptions = {}): Promise<boolean> {
    if (actor.type === 'user' && actor.user.role !== 'agency') {
      throw new ForbiddenException('Only the agency can change a ticket status.');
    }

    return this.dataSource.transaction(async (manager: EntityManager) => {
      const ticket = await this.lock(manager, id);
      if (options.onlyFrom && ticket.status !== options.onlyFrom) {
        return false;
      }
      await this.applyStatusChange(manager, ticket, to, actor, message, options);
      return true;
    });
  }

  /**
   * Moves the oldest "pending" ticket of a site to "in_progress", unless the site already has a ticket
   * being coded or reviewed. Two agents editing the same repo at once would conflict.
   * Returns the claimed ticket, or null when there is nothing to start.
   */
  async claimNextForCoding(siteId: string): Promise<Ticket | null> {
    return this.dataSource.transaction(async (manager) => {
      // Locking the site row makes claims for the same site wait for each other.
      await manager.query('SELECT id FROM sites WHERE id = $1 FOR UPDATE', [siteId]);
      if (await manager.count(Ticket, { where: { siteId, status: In(SITE_BUSY_STATUSES) } })) {
        return null;
      }
      const next = await manager.findOne(Ticket, {
        where: { siteId, status: 'pending' },
        order: { createdAt: 'ASC', id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!next) return null;

      await this.applyStatusChange(manager, next, 'in_progress', { type: 'system' }, 'Work on the change has started.');
      return next;
    });
  }

  /** Adds a note to the history, e.g. that an attempt failed and will be retried. */
  async addNote(id: number, actor: Actor, message: string, data?: Record<string, unknown>): Promise<void> {
    await this.dataSource.transaction((manager) => this.addEvent(manager, id, actor, 'note', message, { data: data ?? null }));
  }

  /** How many times the ticket has entered a status. Numbers each run of a stage (thread and job ids). */
  async countEntries(id: number, status: TicketStatus): Promise<number> {
    return this.events.count({ where: { ticketId: id, toStatus: status } });
  }

  async findById(id: number): Promise<Ticket> {
    return this.findWithRelations(id);
  }

  /** Tickets an agent should be working on right now. Used to re-add lost jobs after a restart. */
  async findInFlight(): Promise<Ticket[]> {
    return this.tickets.find({ where: { status: In(['intake', 'in_progress', 'in_review']) }, order: { id: 'ASC' } });
  }

  async sitesWithPendingTickets(): Promise<string[]> {
    const rows: { site_id: string }[] = await this.dataSource.query(
      `SELECT DISTINCT site_id FROM tickets WHERE status = 'pending'`,
    );
    return rows.map((row) => row.site_id);
  }

  /** The client's answer in the current intake run that the agent hasn't asked a new question after, if any. */
  async unprocessedAnswer(id: number): Promise<{ answer: string; number: number } | null> {
    const rows: { type: string; message: string; number: number }[] = await this.dataSource.query(
      `SELECT type, message, (data->>'number')::int AS number FROM ticket_events
       WHERE ticket_id = $1 AND type IN ('agent_question', 'client_answer')
         AND id > (SELECT max(id) FROM ticket_events WHERE ticket_id = $1 AND to_status = 'intake')
       ORDER BY id DESC LIMIT 1`,
      [id],
    );
    const last = rows[0];
    return last?.type === 'client_answer' ? { answer: last.message, number: last.number } : null;
  }

  /** Saves the Intake Agent's question. Ignored (returns false) if the ticket is no longer in intake. */
  async recordQuestion(id: number, question: PendingQuestion, data?: Record<string, unknown>): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const ticket = await this.lock(manager, id);
      if (ticket.status !== 'intake') return false;

      await manager.update(Ticket, { id }, { pendingQuestion: question });
      await this.addEvent(manager, id, { type: 'agent', agent: 'intake' }, 'agent_question', question.question, {
        data: { number: question.number, max: question.max, ...data },
      });
      return true;
    });
  }

  /** Saves the client's answer to the open question. Only the client who owns the site can answer. */
  async recordAnswer(user: User, id: number, answer: string): Promise<{ questionNumber: number }> {
    return this.dataSource.transaction(async (manager) => {
      const ticket = await manager.findOne(Ticket, {
        where: { id },
        relations: { site: true },
        lock: { mode: 'pessimistic_write', tables: ['tickets'] },
      });
      if (!ticket || (user.role !== 'agency' && ticket.site.clientId !== user.clientId)) {
        throw new NotFoundException(`Ticket ${id} not found.`);
      }
      if (user.role !== 'client') {
        throw new ForbiddenException('Only the client can answer questions about their request.');
      }
      if (ticket.status !== 'intake' || !ticket.pendingQuestion) {
        throw new ConflictException('This request has no open question.');
      }

      const questionNumber = ticket.pendingQuestion.number;
      await manager.update(Ticket, { id }, { pendingQuestion: null });
      await this.addEvent(manager, id, { type: 'user', user }, 'client_answer', answer, { data: { number: questionNumber } });
      return { questionNumber };
    });
  }

  private async applyStatusChange(
    manager: EntityManager,
    ticket: Ticket,
    to: TicketStatus,
    actor: Actor,
    message?: string,
    options: StatusChangeOptions = {},
  ): Promise<void> {
    if (!canTransition(ticket.status, to)) {
      throw new ConflictException(`A ticket can't move from "${ticket.status}" to "${to}".`);
    }
    const from = ticket.status;
    // Leaving intake ends the conversation, so no question can stay open.
    await manager.update(Ticket, { id: ticket.id }, { ...options.fields, status: to, pendingQuestion: null });
    await this.addEvent(manager, ticket.id, actor, 'status_changed', message, {
      fromStatus: from,
      toStatus: to,
      data: options.data ?? null,
    });
    ticket.status = to;
  }

  private async lock(manager: EntityManager, id: number): Promise<Ticket> {
    // Lock the row so two changes to the same ticket can't interleave.
    const ticket = await manager.findOne(Ticket, { where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!ticket) {
      throw new NotFoundException(`Ticket ${id} not found.`);
    }
    return ticket;
  }

  private async addEvent(
    manager: EntityManager,
    ticketId: number,
    actor: Actor,
    type: TicketEvent['type'],
    message: string | undefined,
    extra: Partial<Pick<TicketEvent, 'fromStatus' | 'toStatus' | 'data'>> = {},
  ): Promise<void> {
    await manager.save(
      manager.create(TicketEvent, { ticketId, type, ...actorColumns(actor), message: message?.trim() || null, ...extra }),
    );
  }

  private async findWithRelations(id: number): Promise<Ticket> {
    const ticket = await this.tickets.findOne({ where: { id }, relations: { site: true, createdBy: true } });
    if (!ticket) {
      throw new NotFoundException(`Ticket ${id} not found.`);
    }
    return ticket;
  }
}

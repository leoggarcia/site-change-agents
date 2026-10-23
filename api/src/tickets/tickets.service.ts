import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { EntityManager, FindOptionsWhere } from 'typeorm';
import { SitesService } from '../sites/sites.service.js';
import type { User } from '../users/user.entity.js';
import type { CreateTicketDto } from './dto/create-ticket.dto.js';
import { TicketEvent } from './ticket-event.entity.js';
import { canTransition, TICKET_TRANSITIONS } from './ticket-status.js';
import type { TicketStatus } from './ticket-status.js';
import { Ticket } from './ticket.entity.js';
import { toTicketEventView, toTicketView } from './ticket.views.js';
import type { TicketDetailView, TicketView } from './ticket.views.js';

/** Who made a change. Agents and the system will use this from Phase 3 on. */
export type Actor = { type: 'user'; user: User } | { type: 'agent'; agent: string } | { type: 'system' };

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
      await manager.save(
        manager.create(TicketEvent, {
          ticketId: ticket.id,
          type: 'created',
          ...actorColumns({ type: 'user', user }),
          toStatus: 'intake',
          message: 'Request received.',
        }),
      );
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
      events: events.map(toTicketEventView),
      allowedTransitions: user.role === 'agency' ? [...TICKET_TRANSITIONS[ticket.status]] : [],
    };
  }

  /** The only way a ticket's status changes. Validates the transition and records it in the audit trail. */
  async changeStatus(id: number, to: TicketStatus, actor: Actor, message?: string): Promise<void> {
    if (actor.type === 'user' && actor.user.role !== 'agency') {
      throw new ForbiddenException('Only the agency can change a ticket status.');
    }

    await this.dataSource.transaction(async (manager: EntityManager) => {
      // Lock the row so two changes to the same ticket can't interleave.
      const ticket = await manager.findOne(Ticket, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!ticket) {
        throw new NotFoundException(`Ticket ${id} not found.`);
      }
      if (!canTransition(ticket.status, to)) {
        throw new ConflictException(`A ticket can't move from "${ticket.status}" to "${to}".`);
      }

      const from = ticket.status;
      await manager.update(Ticket, { id }, { status: to });
      await manager.save(
        manager.create(TicketEvent, {
          ticketId: id,
          type: 'status_changed',
          ...actorColumns(actor),
          fromStatus: from,
          toStatus: to,
          message: message?.trim() || null,
        }),
      );
    });
  }

  private async findWithRelations(id: number): Promise<Ticket> {
    const ticket = await this.tickets.findOne({ where: { id }, relations: { site: true, createdBy: true } });
    if (!ticket) {
      throw new NotFoundException(`Ticket ${id} not found.`);
    }
    return ticket;
  }
}

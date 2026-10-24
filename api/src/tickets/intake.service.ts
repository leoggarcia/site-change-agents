import { Injectable, Logger } from '@nestjs/common';
import { AgentsClient } from '../agents/agents.client.js';
import type { IntakeResult } from '../agents/agents.client.js';
import type { User } from '../users/user.entity.js';
import { TicketsService } from './tickets.service.js';
import type { Actor } from './tickets.service.js';

const INTAKE_AGENT: Actor = { type: 'agent', agent: 'intake' };

/**
 * Runs the Intake Agent for a ticket and saves what it returns: a question for the client,
 * a structured ticket, or a hand-off to the agency.
 *
 * Phase 3 runs each call in the background of this process (the panel polls the ticket).
 * Phase 4 replaces that with BullMQ jobs, which survive restarts and retry on failure.
 */
@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name);
  /** The latest agent call per ticket. New calls for a ticket wait for the previous one. */
  private readonly running = new Map<number, Promise<void>>();

  constructor(
    private readonly agents: AgentsClient,
    private readonly tickets: TicketsService,
  ) {}

  start(ticket: { id: number; siteId: string; request: string }): void {
    this.run(ticket.id, () => this.agents.startIntake(ticket.id, ticket.siteId, ticket.request));
  }

  async answer(user: User, ticketId: number, answer: string): Promise<void> {
    await this.tickets.recordAnswer(user, ticketId, answer);
    this.run(ticketId, () => this.agents.answerIntake(ticketId, answer));
  }

  /** Resolves once the ticket's agent calls have finished and their results are saved. Used by tests. */
  async settled(ticketId: number): Promise<void> {
    await this.running.get(ticketId);
  }

  private run(ticketId: number, call: () => Promise<IntakeResult>): void {
    const previous = this.running.get(ticketId) ?? Promise.resolve();
    const next = previous
      .then(async () => this.save(ticketId, await call()))
      .catch((error: unknown) => this.handOffAfterError(ticketId, error))
      .finally(() => {
        if (this.running.get(ticketId) === next) this.running.delete(ticketId);
      });
    this.running.set(ticketId, next);
  }

  private async save(ticketId: number, result: IntakeResult): Promise<void> {
    const trace = { reasoning: result.reasoning ?? null, sources: result.sources ?? [], usage: result.usage ?? {} };
    // Every write uses onlyFrom/intake checks: if the agency moved the ticket meanwhile, the result is dropped.
    switch (result.status) {
      case 'question':
        await this.tickets.recordQuestion(ticketId, { question: result.question, number: result.number, max: result.max }, trace);
        return;
      case 'ticket': {
        const { ticket } = result;
        await this.tickets.changeStatus(ticketId, 'pending', INTAKE_AGENT, `Your request is clear: ${ticket.summary}`, {
          onlyFrom: 'intake',
          data: trace,
          fields: {
            summary: ticket.summary,
            changeType: ticket.change_type,
            target: ticket.target,
            details: ticket.details,
            acceptanceCriteria: ticket.acceptance_criteria,
            risk: ticket.risk,
          },
        });
        return;
      }
      case 'out_of_scope':
        await this.tickets.changeStatus(ticketId, 'needs_human', INTAKE_AGENT, result.message, {
          onlyFrom: 'intake',
          data: trace,
          fields: { changeType: 'out_of_scope' },
        });
        return;
      case 'needs_human':
        await this.tickets.changeStatus(ticketId, 'needs_human', INTAKE_AGENT, result.message, {
          onlyFrom: 'intake',
          data: trace,
        });
    }
  }

  private async handOffAfterError(ticketId: number, error: unknown): Promise<void> {
    const reason = error instanceof Error ? error.message : String(error);
    this.logger.error(`Intake for ticket ${ticketId} failed: ${reason}`);
    try {
      // A person takes over; moving the ticket back to "intake" runs the agent again.
      await this.tickets.changeStatus(
        ticketId,
        'needs_human',
        { type: 'system' },
        'The intake assistant could not finish, so a person from the agency will take over.',
        { onlyFrom: 'intake', data: { error: reason.slice(0, 500) } },
      );
    } catch (saveError) {
      this.logger.error(`Could not hand off ticket ${ticketId}: ${String(saveError)}`);
    }
  }
}

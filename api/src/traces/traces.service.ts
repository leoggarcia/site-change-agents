import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ticket } from '../tickets/ticket.entity.js';
import { langfuseConfig, sessionObservations } from './langfuse.js';
import { buildTicketTrace, emptyTrace } from './ticket-trace.js';
import type { TicketTraceView } from './ticket-trace.js';

/** Tickets whose agents are done change rarely, so their trace can be cached longer. */
const SETTLED = new Set(['deployed', 'failed', 'needs_human', 'awaiting_approval']);
const CACHE_MS = { active: 10_000, settled: 5 * 60_000 };

/** "How the agents worked" on a ticket, read from Langfuse. */
@Injectable()
export class TracesService {
  private readonly logger = new Logger(TracesService.name);
  private readonly cache = new Map<number, { status: string; until: number; view: TicketTraceView }>();

  constructor(@InjectRepository(Ticket) private readonly tickets: Repository<Ticket>) {}

  async forTicket(id: number): Promise<TicketTraceView> {
    const ticket = await this.tickets.findOneBy({ id });
    if (!ticket) throw new NotFoundException(`Ticket ${id} not found.`);

    const config = langfuseConfig();
    if (!config) return emptyTrace('not_configured');

    const cached = this.cache.get(id);
    if (cached && cached.status === ticket.status && cached.until > Date.now()) return cached.view;

    // The worker names each ticket's session "ticket-<id>" (agents/src/change_agents/tracing.py).
    const sessionId = `ticket-${id}`;
    try {
      // A little before the ticket was created, so the first intake run is included.
      const from = new Date(ticket.createdAt.getTime() - 60_000);
      const view = buildTicketTrace(await sessionObservations(config, sessionId, from), config.baseUrl, sessionId);
      const ttl = SETTLED.has(ticket.status) ? CACHE_MS.settled : CACHE_MS.active;
      this.cache.set(id, { status: ticket.status, until: Date.now() + ttl, view });
      return view;
    } catch (error) {
      this.logger.warn(`Could not read the trace of ticket ${id}: ${error instanceof Error ? error.message : String(error)}`);
      return emptyTrace('unreachable');
    }
  }
}

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Job, Queue } from 'bullmq';
import { In, Not, Repository } from 'typeorm';
import { CODING_QUEUE, DELIVERY_QUEUE, INTAKE_QUEUE, REINDEX_QUEUE, REVIEW_QUEUE } from '../queues/queues.js';
import { TicketEvent } from '../tickets/ticket-event.entity.js';
import type { TicketStatus } from '../tickets/ticket-status.js';
import { Ticket } from '../tickets/ticket.entity.js';

export type AgentKey = 'intake' | 'coder' | 'reviewer' | 'publisher' | 'indexer';

export interface AgentActivity {
  agent: AgentKey;
  /** What it is doing right now, one entry per running job. Empty when idle. */
  working: { ticketId: number | null; label: string; since: string; attempt: number }[];
  waiting: number;
  retrying: number;
}

export interface BoardTicket {
  id: number;
  summary: string;
  siteName: string;
  status: TicketStatus;
  /** When the ticket entered its current status. */
  since: string;
  /** Waiting for the client: an open question, or a preview to approve. */
  waitingForClient: boolean;
  publishing: boolean;
  previewUrl: string | null;
  /** The agent working on it right now, if any. */
  activeAgent: AgentKey | null;
  activeLabel: string | null;
}

export interface BoardView {
  agents: AgentActivity[];
  tickets: BoardTicket[];
  at: string;
}

/** How many live tickets the board keeps showing (the rest are in Requests). */
const RECENT_LIVE = 6;

type JobData = { ticketId?: number; siteId?: string; action?: string; revision?: unknown };

/**
 * The agency's live view: what each agent is doing (straight from the BullMQ queues) and where every
 * ticket is in the pipeline (from the tickets and their history).
 */
@Injectable()
export class BoardService {
  private readonly queues: { agent: AgentKey; queue: Queue }[];

  constructor(
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectRepository(TicketEvent) private readonly events: Repository<TicketEvent>,
    @InjectQueue(INTAKE_QUEUE) intake: Queue,
    @InjectQueue(CODING_QUEUE) coding: Queue,
    @InjectQueue(REVIEW_QUEUE) review: Queue,
    @InjectQueue(DELIVERY_QUEUE) delivery: Queue,
    @InjectQueue(REINDEX_QUEUE) reindex: Queue,
  ) {
    this.queues = [
      { agent: 'intake', queue: intake },
      { agent: 'coder', queue: coding },
      { agent: 'reviewer', queue: review },
      { agent: 'publisher', queue: delivery },
      { agent: 'indexer', queue: reindex },
    ];
  }

  async view(): Promise<BoardView> {
    const agents = await Promise.all(this.queues.map(({ agent, queue }) => this.activity(agent, queue)));
    const active = new Map<number, { agent: AgentKey; label: string }>();
    for (const activity of agents) {
      for (const job of activity.working) {
        if (job.ticketId !== null) active.set(job.ticketId, { agent: activity.agent, label: job.label });
      }
    }
    return { agents, tickets: await this.boardTickets(active), at: new Date().toISOString() };
  }

  private async activity(agent: AgentKey, queue: Queue): Promise<AgentActivity> {
    const [jobs, counts, delayed] = await Promise.all([
      queue.getJobs(['active']),
      queue.getJobCounts('waiting', 'prioritized'),
      queue.getJobs(['delayed']),
    ]);
    return {
      agent,
      working: jobs.map((job: Job<JobData>) => ({
        ticketId: job.data.ticketId ?? null,
        label: describe(agent, job),
        since: new Date(job.processedOn ?? job.timestamp).toISOString(),
        attempt: job.attemptsMade + 1,
      })),
      waiting: (counts.waiting ?? 0) + (counts.prioritized ?? 0),
      // A delayed job here is a retry waiting for its backoff.
      retrying: delayed.length,
    };
  }

  private async boardTickets(active: Map<number, { agent: AgentKey; label: string }>): Promise<BoardTicket[]> {
    const open = await this.tickets.find({ where: { status: Not('deployed') }, relations: { site: true } });
    const live = await this.tickets.find({
      where: { status: 'deployed' },
      relations: { site: true },
      order: { updatedAt: 'DESC' },
      take: RECENT_LIVE,
    });
    const all = [...open, ...live];
    if (all.length === 0) return [];

    // When each ticket entered its current status, and whether the client already approved its preview.
    const events = await this.events.find({
      where: { ticketId: In(all.map((ticket) => ticket.id)) },
      order: { id: 'ASC' },
    });
    const since = new Map<number, Date>();
    const approved = new Set<number>();
    for (const event of events) {
      if (event.toStatus) {
        since.set(event.ticketId, event.createdAt);
        approved.delete(event.ticketId);
      }
      if (event.type === 'note' && event.data?.approved === true) approved.add(event.ticketId);
    }

    return all.map((ticket) => {
      const publishing = ticket.status === 'awaiting_approval' && approved.has(ticket.id);
      const job = active.get(ticket.id);
      return {
        id: ticket.id,
        summary: ticket.summary ?? ticket.request,
        siteName: ticket.site.name,
        status: ticket.status,
        since: (since.get(ticket.id) ?? ticket.createdAt).toISOString(),
        waitingForClient: Boolean(ticket.pendingQuestion) || (ticket.status === 'awaiting_approval' && !publishing),
        publishing,
        previewUrl: ticket.previewUrl,
        activeAgent: job?.agent ?? null,
        activeLabel: job?.label ?? null,
      };
    });
  }
}

/** A short, human description of a running job, e.g. "Fixing review comments on #14". */
function describe(agent: AgentKey, job: Job<JobData>): string {
  const ticket = job.data.ticketId ? `#${job.data.ticketId}` : '';
  switch (agent) {
    case 'intake':
      return job.data.action === 'answer' ? `Reading the client's answer on ${ticket}` : `Reading request ${ticket}`;
    case 'coder':
      return job.data.revision ? `Fixing review comments on ${ticket}` : `Changing the site for ${ticket}`;
    case 'reviewer':
      return `Checking the change on ${ticket}`;
    case 'publisher':
      return job.data.action === 'merge' ? `Publishing ${ticket}` : `Preparing the preview of ${ticket}`;
    case 'indexer':
      return `Re-indexing ${job.data.siteId ?? 'a site'}`;
  }
}

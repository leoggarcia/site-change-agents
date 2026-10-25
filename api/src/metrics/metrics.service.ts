import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TicketEvent } from '../tickets/ticket-event.entity.js';
import { TICKET_STATUSES } from '../tickets/ticket-status.js';
import type { TicketStatus } from '../tickets/ticket-status.js';
import { Ticket } from '../tickets/ticket.entity.js';
import { agentModel, costUsd, MODEL_PRICES, PRICE_SOURCE } from './model-prices.js';

type Agent = 'intake' | 'coder' | 'reviewer';
const AGENTS: Agent[] = ['intake', 'coder', 'reviewer'];

/**
 * The comparison the business case rests on. An estimate, not a measurement: a small change sent by email
 * usually waits for a developer, gets made, waits for the client's OK and is published the next working day.
 */
const BASELINE = { hours: 24, label: 'Typical agency turnaround for a small change (estimate)' };

export interface TicketTimeline {
  id: number;
  siteName: string;
  summary: string;
  leadMinutes: number;
  agentMinutes: number;
  clientWaitMinutes: number;
  publishMinutes: number;
  /** No one from the agency touched it: the client's approval was the only human step. */
  automated: boolean;
  tokens: { input: number; output: number };
  costUsd: number | null;
}

export interface MetricsView {
  statusCounts: Record<TicketStatus, number>;
  live: {
    count: number;
    medianLeadMinutes: number | null;
    avgAgentMinutes: number | null;
    avgClientWaitMinutes: number | null;
    avgPublishMinutes: number | null;
    automatedShare: number | null;
    avgCostUsd: number | null;
    avgTokens: { input: number; output: number } | null;
  };
  handoffs: { outOfScope: number; byAgents: number; failed: number };
  recent: TicketTimeline[];
  baseline: typeof BASELINE;
  prices: { models: Record<Agent, string>; source: string; table: typeof MODEL_PRICES };
}

const minutes = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 60_000;
const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
}

/**
 * Business metrics, computed from the tickets' audit trail: every status change, question, answer and
 * approval is an event with a timestamp, and the agents store their token usage on the events they write.
 */
@Injectable()
export class MetricsService {
  constructor(
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectRepository(TicketEvent) private readonly events: Repository<TicketEvent>,
  ) {}

  async overview(): Promise<MetricsView> {
    const tickets = await this.tickets.find({ relations: { site: true } });
    const events = await this.events.find({ relations: { actorUser: true }, order: { id: 'ASC' } });
    const byTicket = new Map<number, TicketEvent[]>();
    for (const event of events) byTicket.set(event.ticketId, [...(byTicket.get(event.ticketId) ?? []), event]);

    const statusCounts = Object.fromEntries(TICKET_STATUSES.map((status) => [status, 0])) as Record<TicketStatus, number>;
    for (const ticket of tickets) statusCounts[ticket.status] += 1;

    const timelines = tickets
      .filter((ticket) => ticket.status === 'deployed')
      .map((ticket) => this.timeline(ticket, byTicket.get(ticket.id) ?? []))
      .filter((timeline): timeline is TicketTimeline => timeline !== null)
      .sort((a, b) => b.id - a.id);

    const costs = timelines.map((timeline) => timeline.costUsd).filter((cost): cost is number => cost !== null);
    const handedOff = tickets.filter((ticket) => ticket.status === 'needs_human');
    return {
      statusCounts,
      live: {
        count: timelines.length,
        medianLeadMinutes: nullableRound(median(timelines.map((t) => t.leadMinutes))),
        avgAgentMinutes: nullableRound(average(timelines.map((t) => t.agentMinutes))),
        avgClientWaitMinutes: nullableRound(average(timelines.map((t) => t.clientWaitMinutes))),
        avgPublishMinutes: nullableRound(average(timelines.map((t) => t.publishMinutes))),
        automatedShare: nullableRound(average(timelines.map((t) => (t.automated ? 1 : 0))), 3),
        avgCostUsd: costs.length ? round(average(costs)!, 5) : null,
        avgTokens: timelines.length
          ? {
              input: Math.round(average(timelines.map((t) => t.tokens.input))!),
              output: Math.round(average(timelines.map((t) => t.tokens.output))!),
            }
          : null,
      },
      handoffs: {
        outOfScope: handedOff.filter((ticket) => ticket.changeType === 'out_of_scope').length,
        byAgents: handedOff.filter((ticket) => ticket.changeType !== 'out_of_scope').length,
        failed: statusCounts.failed,
      },
      recent: timelines.slice(0, 10),
      baseline: BASELINE,
      prices: {
        models: { intake: agentModel('intake'), coder: agentModel('coder'), reviewer: agentModel('reviewer') },
        source: PRICE_SOURCE,
        table: MODEL_PRICES,
      },
    };
  }

  /** Splits a live ticket's time into the agents' work, waiting for the client, and publishing. */
  private timeline(ticket: Ticket, events: TicketEvent[]): TicketTimeline | null {
    const deployed = events.findLast((event) => event.toStatus === 'deployed');
    if (!deployed) return null;

    let clientWait = 0;
    let publish = 0;
    let waitingSince: Date | null = null;
    for (const event of events) {
      const startsWait = event.type === 'agent_question' || event.toStatus === 'awaiting_approval';
      const endsWait =
        event.type === 'client_answer' ||
        (event.type === 'note' && event.data?.approved === true) ||
        (event.toStatus === 'in_progress' && event.actorType === 'user');
      if (startsWait) waitingSince = event.createdAt;
      else if (endsWait && waitingSince) {
        clientWait += minutes(waitingSince, event.createdAt);
        waitingSince = null;
        if (event.type === 'note') publish = minutes(event.createdAt, deployed.createdAt);
      }
    }

    const lead = minutes(ticket.createdAt, deployed.createdAt);
    const agencyTouched = events.some(
      (event) =>
        event.actorUser?.role === 'agency' || event.toStatus === 'needs_human' || event.toStatus === 'failed',
    );
    const tokens = { input: 0, output: 0 };
    let cost: number | null = 0;
    for (const agent of AGENTS) {
      const usage = this.agentUsage(agent, events);
      tokens.input += usage.input;
      tokens.output += usage.output;
      const agentCost = costUsd(agentModel(agent), usage.input, usage.output);
      cost = cost === null || agentCost === null ? null : cost + agentCost;
    }

    return {
      id: ticket.id,
      siteName: ticket.site.name,
      summary: ticket.summary ?? ticket.request,
      leadMinutes: round(lead),
      agentMinutes: round(Math.max(0, lead - clientWait - publish)),
      clientWaitMinutes: round(clientWait),
      publishMinutes: round(publish),
      automated: !agencyTouched,
      tokens,
      costUsd: cost === null ? null : round(cost, 5),
    };
  }

  /**
   * Tokens an agent used on a ticket. The intake's usage is cumulative within one conversation, so only the
   * event that ends each conversation counts; the coder and reviewer store each run's own usage.
   */
  private agentUsage(agent: Agent, events: TicketEvent[]): { input: number; output: number } {
    const relevant = events.filter(
      (event) =>
        event.actorAgent === agent &&
        event.data?.usage &&
        (agent !== 'intake' || event.type === 'status_changed'),
    );
    return relevant.reduce(
      (total, event) => {
        const usage = event.data!.usage as Usage;
        return { input: total.input + (usage.input_tokens ?? 0), output: total.output + (usage.output_tokens ?? 0) };
      },
      { input: 0, output: 0 },
    );
  }
}

function nullableRound(value: number | null, digits = 1): number | null {
  return value === null ? null : round(value, digits);
}

import type { TicketEvent } from './ticket-event.entity.js';
import type { TicketStatus } from './ticket-status.js';
import type { Ticket } from './ticket.entity.js';

export interface TicketView {
  id: number;
  siteId: string;
  siteName: string;
  request: string;
  status: TicketStatus;
  summary: string | null;
  changeType: Ticket['changeType'];
  target: Ticket['target'];
  details: string | null;
  acceptanceCriteria: string[] | null;
  risk: Ticket['risk'];
  /** The Intake Agent's question waiting for the client's answer, if any. */
  pendingQuestion: Ticket['pendingQuestion'];
  createdBy: { id: string; name: string };
  createdAt: Date;
  updatedAt: Date;
}

export interface TicketEventView {
  id: string;
  type: TicketEvent['type'];
  actor: { type: TicketEvent['actorType']; name: string };
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus | null;
  message: string | null;
  /** Client knowledge the agent relied on, e.g. "Luna Café plan: Basic › What the plan does not include". */
  sources: string[];
  /** The agent's internal note on why it decided this. Only shown to the agency. */
  reasoning: string | null;
  createdAt: Date;
}

export interface TicketDetailView extends TicketView {
  events: TicketEventView[];
  /** Statuses the current user may move this ticket to. Empty for clients. */
  allowedTransitions: TicketStatus[];
}

export function toTicketView(ticket: Ticket): TicketView {
  return {
    id: ticket.id,
    siteId: ticket.siteId,
    siteName: ticket.site.name,
    request: ticket.request,
    status: ticket.status,
    summary: ticket.summary,
    changeType: ticket.changeType,
    target: ticket.target,
    details: ticket.details,
    acceptanceCriteria: ticket.acceptanceCriteria,
    risk: ticket.risk,
    pendingQuestion: ticket.pendingQuestion,
    createdBy: { id: ticket.createdBy.id, name: ticket.createdBy.name },
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

export function toTicketEventView(event: TicketEvent, forAgency: boolean): TicketEventView {
  const name =
    event.actorType === 'user'
      ? (event.actorUser?.name ?? 'Unknown user')
      : event.actorType === 'agent'
        ? `${event.actorAgent} agent`
        : 'System';
  return {
    id: event.id,
    type: event.type,
    actor: { type: event.actorType, name },
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    message: event.message,
    sources: Array.isArray(event.data?.sources) ? (event.data.sources as string[]) : [],
    reasoning: forAgency && typeof event.data?.reasoning === 'string' ? event.data.reasoning : null,
    createdAt: event.createdAt,
  };
}

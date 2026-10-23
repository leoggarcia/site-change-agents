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
    createdBy: { id: ticket.createdBy.id, name: ticket.createdBy.name },
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

export function toTicketEventView(event: TicketEvent): TicketEventView {
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
    createdAt: event.createdAt,
  };
}

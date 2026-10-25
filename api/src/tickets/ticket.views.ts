import type { ReviewResult } from '../agents/agent-results.js';
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
  /** The Coder Agent's change. Only sent to the agency. */
  change: { branch: string; commitSha: string | null; files: string[]; prNumber: number | null; prUrl: string | null } | null;
  /** Where the client can see the change before approving it, and where it is live afterwards. */
  previewUrl: string | null;
  productionUrl: string | null;
  createdBy: { id: string; name: string };
  createdAt: Date;
  updatedAt: Date;
}

export interface TicketEventView {
  id: string;
  type: TicketEvent['type'];
  /** `agent` is the agent's key ("intake", "coder", "reviewer"); `role` tells clients from agency staff. */
  actor: { type: TicketEvent['actorType']; name: string; agent: string | null; role: 'client' | 'agency' | null };
  /** For questions and answers: which question of the intake conversation. */
  questionNumber: number | null;
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus | null;
  message: string | null;
  /** Client knowledge the agent relied on, e.g. "Luna Café plan: Basic › What the plan does not include". */
  sources: string[];
  /** The agent's internal note on why it decided this. Only shown to the agency. */
  reasoning: string | null;
  /** Technical error behind a failure or retry. Only shown to the agency. */
  error: string | null;
  /** The checks and the Reviewer Agent's findings, on review events. Only shown to the agency. */
  review: Pick<ReviewResult, 'decidedBy' | 'checks' | 'issues' | 'criteria'> | null;
  createdAt: Date;
}

export interface TicketDetailView extends TicketView {
  events: TicketEventView[];
  /** Statuses the current user may move this ticket to. Empty for clients. */
  allowedTransitions: TicketStatus[];
  /** Approved and being published (merge and production deploy running). */
  publishing: boolean;
}

export function toTicketView(ticket: Ticket, forAgency = false): TicketView {
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
    change:
      forAgency && ticket.branch
        ? {
            branch: ticket.branch,
            commitSha: ticket.commitSha,
            files: ticket.changedFiles ?? [],
            prNumber: ticket.prNumber,
            prUrl: ticket.prUrl,
          }
        : null,
    previewUrl: ticket.previewUrl,
    productionUrl: ticket.productionUrl,
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
    actor: { type: event.actorType, name, agent: event.actorAgent, role: event.actorUser?.role ?? null },
    questionNumber: typeof event.data?.number === 'number' ? event.data.number : null,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    message: event.message,
    sources: Array.isArray(event.data?.sources) ? (event.data.sources as string[]) : [],
    reasoning: forAgency && typeof event.data?.reasoning === 'string' ? event.data.reasoning : null,
    error: forAgency && typeof event.data?.error === 'string' ? event.data.error : null,
    review:
      forAgency && Array.isArray(event.data?.checks)
        ? (({ decidedBy, checks, issues, criteria }) => ({ decidedBy, checks, issues, criteria }))(
            event.data as unknown as ReviewResult,
          )
        : null,
    createdAt: event.createdAt,
  };
}

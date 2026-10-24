export const TICKET_STATUSES = [
  'intake',
  'pending',
  'in_progress',
  'in_review',
  'awaiting_approval',
  'deployed',
  'failed',
  'needs_human',
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

/**
 * Which status a ticket may move to from each status.
 * The API enforces this for every change, whether a person or an agent makes it.
 */
export const TICKET_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  intake: ['pending', 'needs_human', 'failed'],
  pending: ['in_progress', 'needs_human', 'failed'],
  in_progress: ['in_review', 'needs_human', 'failed'],
  in_review: ['awaiting_approval', 'in_progress', 'needs_human', 'failed'],
  awaiting_approval: ['deployed', 'in_progress', 'failed'],
  deployed: [],
  failed: ['pending', 'needs_human'],
  needs_human: ['intake', 'pending', 'failed'],
};

/** While a site has a ticket in one of these, no other ticket of that site starts coding. */
export const SITE_BUSY_STATUSES: readonly TicketStatus[] = ['in_progress', 'in_review'];

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return TICKET_TRANSITIONS[from].includes(to);
}

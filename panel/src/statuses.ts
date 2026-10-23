import type { TicketStatus } from './types'

/** Client-facing wording for each status. */
export const STATUS_INFO: Record<TicketStatus, { label: string; description: string; tone: string }> = {
  intake: { label: 'Reviewing request', description: 'We are reading your request and may ask you a question.', tone: 'info' },
  pending: { label: 'Queued', description: 'Your request is clear and waiting to be worked on.', tone: 'info' },
  in_progress: { label: 'In progress', description: 'The change is being made.', tone: 'progress' },
  in_review: { label: 'In review', description: 'The change is being checked before you see it.', tone: 'progress' },
  awaiting_approval: { label: 'Ready for approval', description: 'A preview is ready. Approve it to publish.', tone: 'attention' },
  deployed: { label: 'Live', description: 'The change is live on your website.', tone: 'success' },
  failed: { label: 'Failed', description: 'Something went wrong. The agency has been notified.', tone: 'danger' },
  needs_human: { label: 'With the agency', description: 'A person from the agency will handle this request.', tone: 'attention' },
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

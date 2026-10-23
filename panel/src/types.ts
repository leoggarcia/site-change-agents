// Mirrors the API's response shapes (api/src/**/*.views.ts and controllers).

export type Role = 'client' | 'agency'

export type TicketStatus =
  | 'intake'
  | 'pending'
  | 'in_progress'
  | 'in_review'
  | 'awaiting_approval'
  | 'deployed'
  | 'failed'
  | 'needs_human'

export interface User {
  id: string
  name: string
  email: string
  role: Role
  clientName: string | null
}

export interface Site {
  id: string
  name: string
  clientName: string
  plan: string
}

export interface Ticket {
  id: number
  siteId: string
  siteName: string
  request: string
  status: TicketStatus
  summary: string | null
  changeType: string | null
  target: { page: string; section: string } | null
  details: string | null
  acceptanceCriteria: string[] | null
  risk: 'low' | 'medium' | 'high' | null
  createdBy: { id: string; name: string }
  createdAt: string
  updatedAt: string
}

export interface TicketEvent {
  id: string
  type: 'created' | 'status_changed' | 'note'
  actor: { type: 'user' | 'agent' | 'system'; name: string }
  fromStatus: TicketStatus | null
  toStatus: TicketStatus | null
  message: string | null
  createdAt: string
}

export interface TicketDetail extends Ticket {
  events: TicketEvent[]
  allowedTransitions: TicketStatus[]
}

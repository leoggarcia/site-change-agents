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

// Written by the Project Indexer agent (agents/src/change_agents/indexer/schema.py).
export interface ProjectSummary {
  site_name: string
  framework: string
  overview: string
  pages: {
    route: string
    file: string
    title: string
    sections: { name: string; component_file: string | null; description: string }[]
  }[]
  shared_components: { file: string; purpose: string; used_on: string[] }[]
  content_locations: { content: string; file: string; how_to_edit: string }[]
  styling: { approach: string; global_stylesheet: string | null; colors: string[]; fonts: string[] }
  notes: string[]
}

export interface ProjectSummaryRecord {
  id: string
  siteId: string
  sourceRef: string
  summary: ProjectSummary
  markdown: string
  model: string
  stats: { input_tokens?: number; output_tokens?: number; model_calls?: number; turns?: number; duration_seconds?: number }
  createdAt: string
}

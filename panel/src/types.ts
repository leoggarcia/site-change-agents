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
  /** The Intake Agent's question waiting for the client's answer. */
  pendingQuestion: { question: string; number: number; max: number } | null
  /** The Coder Agent's change; only sent to the agency. */
  change: { branch: string; commitSha: string | null; files: string[]; prNumber: number | null; prUrl: string | null } | null
  /** Where the client can see the change before approving it, and where it is live afterwards. */
  previewUrl: string | null
  productionUrl: string | null
  createdBy: { id: string; name: string }
  createdAt: string
  updatedAt: string
}

export interface TicketEvent {
  id: string
  type: 'created' | 'status_changed' | 'note' | 'agent_question' | 'client_answer'
  /** `agent` is "intake", "coder" or "reviewer"; `role` tells clients from agency staff. */
  actor: { type: 'user' | 'agent' | 'system'; name: string; agent: string | null; role: Role | null }
  /** For questions and answers: which question of the intake conversation. */
  questionNumber: number | null
  fromStatus: TicketStatus | null
  toStatus: TicketStatus | null
  message: string | null
  /** Client knowledge the agent relied on. */
  sources: string[]
  /** The agent's internal note; only sent to the agency. */
  reasoning: string | null
  /** Technical error behind a failure or retry; only sent to the agency. */
  error: string | null
  /** The automatic checks and the reviewer's findings, on review events; only sent to the agency. */
  review: ReviewDetails | null
  createdAt: string
}

export interface ReviewDetails {
  decidedBy: 'checks' | 'reviewer'
  checks: { name: string; passed: boolean; level: 'blocking' | 'warning'; details: string; findings: string[] }[]
  issues: { severity: 'blocker' | 'major' | 'minor'; file: string | null; problem: string; fix: string }[]
  criteria: { criterion: string; met: boolean; evidence: string }[]
}

export interface TicketDetail extends Ticket {
  events: TicketEvent[]
  allowedTransitions: TicketStatus[]
  /** Approved and being published. */
  publishing: boolean
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

// Business metrics (api/src/metrics/metrics.service.ts).
export interface Metrics {
  statusCounts: Record<TicketStatus, number>
  live: {
    count: number
    medianLeadMinutes: number | null
    avgAgentMinutes: number | null
    avgClientWaitMinutes: number | null
    avgPublishMinutes: number | null
    automatedShare: number | null
    avgCostUsd: number | null
    avgTokens: { input: number; output: number } | null
  }
  handoffs: { outOfScope: number; byAgents: number; failed: number }
  recent: {
    id: number
    siteName: string
    summary: string
    leadMinutes: number
    agentMinutes: number
    clientWaitMinutes: number
    publishMinutes: number
    automated: boolean
    tokens: { input: number; output: number }
    costUsd: number | null
  }[]
  baseline: { hours: number; label: string }
  prices: { models: Record<'intake' | 'coder' | 'reviewer', string>; source: string }
}

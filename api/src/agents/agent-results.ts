import type { Stage } from '../queues/queues.js';
import type { ChangeType, PendingQuestion, RiskLevel, TicketTarget } from '../tickets/ticket.entity.js';

/** The ticket the Intake Agent writes (agents/src/change_agents/intake/schema.py, TicketDraft). */
export interface IntakeTicket {
  summary: string;
  change_type: Exclude<ChangeType, 'out_of_scope'>;
  target: TicketTarget;
  details: string;
  acceptance_criteria: string[];
  risk: RiskLevel;
}

interface IntakeTrace {
  reasoning?: string | null;
  sources?: string[];
  usage?: Record<string, number>;
}

/** Where an intake conversation stands after each job (agents/src/change_agents/intake/runner.py). */
export type IntakeResult =
  | ({ status: 'question' } & PendingQuestion & IntakeTrace)
  | ({ status: 'ticket'; ticket: IntakeTicket } & IntakeTrace)
  | ({ status: 'out_of_scope' | 'needs_human'; message: string } & IntakeTrace);

/** What the Coder Agent returns (agents/src/change_agents/coder/runner.py). */
export type CodingResult = {
  branch: string;
  usage?: Record<string, number>;
  seconds?: number;
} & (
  | {
      status: 'done';
      summary: string;
      commit: string;
      files: string[];
      insertions: number;
      deletions: number;
      buildRounds: number;
    }
  | { status: 'needs_human'; message: string; buildOutput?: string | null }
);

/** One automatic check on a branch (agents/src/change_agents/reviewer/checks.py). */
export interface CheckResult {
  name: string;
  passed: boolean;
  level: 'blocking' | 'warning';
  details: string;
  findings: string[];
}

export interface ReviewIssue {
  severity: 'blocker' | 'major' | 'minor';
  file: string | null;
  problem: string;
  fix: string;
}

/** What the checks and the Reviewer Agent return (agents/src/change_agents/reviewer/graph.py). */
export interface ReviewResult {
  status: 'approved' | 'changes_requested';
  decidedBy: 'checks' | 'reviewer';
  summary: string;
  issues: ReviewIssue[];
  criteria: { criterion: string; met: boolean; evidence: string }[];
  checks: CheckResult[];
  usage?: Record<string, number>;
}
export type ReindexResult = { status: 'done'; code: Record<string, number>; knowledge: Record<string, number> };

/** What delivery jobs return (agents/src/change_agents/delivery/publish.py). */
export type DeliveryResult =
  | { status: 'preview_ready'; prNumber: number; prUrl: string; headSha: string; runUrl: string; previewUrl: string }
  | { status: 'preview_failed'; prNumber: number; prUrl: string; headSha: string; runUrl: string; conclusion: string }
  | { status: 'deployed'; mergeSha: string; runUrl: string; productionUrl: string }
  | { status: 'deploy_failed'; mergeSha: string; runUrl: string; conclusion: string };

/** Sent by the worker instead of a result when an attempt fails. */
export type AttemptFailure = { status: 'retrying' | 'failed'; error: string };

/** One message on the agent-results queue (agents/src/change_agents/worker/processor.py). */
export type AgentReport = {
  jobId: string;
  ticketId: number | null;
  attempt: number;
  attempts: number;
} & (
  | { stage: 'intake'; result: IntakeResult | AttemptFailure }
  | { stage: 'coding'; result: CodingResult | AttemptFailure }
  | { stage: 'review'; result: ReviewResult | AttemptFailure }
  | { stage: 'reindex'; result: ReindexResult | AttemptFailure }
  | { stage: 'delivery'; result: DeliveryResult | AttemptFailure }
);

// Job data the API sends to each queue.
export type IntakeJob =
  | { ticketId: number; threadId: string; action: 'start'; siteId: string; request: string }
  | { ticketId: number; threadId: string; action: 'answer'; siteId: string; answer: string; questionNumber: number };

/** The structured ticket the Coder Agent works from. */
export interface CodingJob {
  ticketId: number;
  siteId: string;
  summary: string;
  details: string;
  changeType: string | null;
  target: { page: string; section: string } | null;
  acceptanceCriteria: string[];
  /** Set when the reviewer asked for changes: continue on the branch from `commit` and fix `feedback`. */
  revision?: { commit: string; feedback: ReviewIssue[] };
}

/** What the reviewer needs: the ticket, the client's own words and the branch to review. */
export interface ReviewJob {
  ticketId: number;
  siteId: string;
  summary: string;
  details: string;
  acceptanceCriteria: string[];
  request: string;
  conversation: { question: string; answer: string }[];
  /** What the client asked to change after seeing earlier previews. */
  clientFeedback: string[];
  branch: string;
  commit: string;
}

export type DeliveryJob =
  | {
      action: 'open_pr';
      ticketId: number;
      siteId: string;
      commit: string;
      summary: string;
      details: string;
      request: string;
      acceptanceCriteria: string[];
      review: { summary: string; checks: CheckResult[] };
      ticketUrl: string;
    }
  | { action: 'merge'; ticketId: number; siteId: string; prNumber: number; summary: string };

export interface ReindexJob {
  siteId: string;
}

export type { Stage };

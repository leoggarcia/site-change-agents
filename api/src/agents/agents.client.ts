import { Injectable } from '@nestjs/common';
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

/** Where an intake conversation stands after each call (agents/src/change_agents/intake/runner.py). */
export type IntakeResult =
  | ({ status: 'question' } & PendingQuestion & IntakeTrace)
  | ({ status: 'ticket'; ticket: IntakeTicket } & IntakeTrace)
  | ({ status: 'out_of_scope' | 'needs_human'; message: string } & IntakeTrace);

/** Model calls can wait on the provider's rate limit, so allow a few minutes. */
const TIMEOUT_MS = 5 * 60_000;

/**
 * HTTP client for the Python agents service. In Phase 4 these calls move to BullMQ jobs;
 * the results keep the same shape.
 */
@Injectable()
export class AgentsClient {
  private readonly baseUrl = process.env.AGENTS_URL ?? 'http://localhost:8000';

  startIntake(ticketId: number, siteId: string, request: string): Promise<IntakeResult> {
    return this.post(`/intake/${ticketId}/start`, { site_id: siteId, request });
  }

  answerIntake(ticketId: number, answer: string): Promise<IntakeResult> {
    return this.post(`/intake/${ticketId}/answer`, { answer });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Agents service answered ${response.status}: ${text.slice(0, 300)}`);
    }
    return (await response.json()) as T;
  }
}

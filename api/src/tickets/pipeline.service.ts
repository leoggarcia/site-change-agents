import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type {
  AgentReport,
  AttemptFailure,
  CodingJob,
  IntakeJob,
  IntakeResult,
  ReviewJob,
} from '../agents/agent-results.js';
import { CODING_QUEUE, INTAKE_QUEUE, REVIEW_QUEUE } from '../queues/queues.js';
import type { Stage } from '../queues/queues.js';
import type { User } from '../users/user.entity.js';
import type { Ticket } from './ticket.entity.js';
import { TicketsService } from './tickets.service.js';
import type { Actor } from './tickets.service.js';

const SYSTEM: Actor = { type: 'system' };
const CODER: Actor = { type: 'agent', agent: 'coder' };
const STAGE_NAMES: Record<Stage, string> = { intake: 'Intake', coding: 'Coding', review: 'Review', reindex: 'Reindex' };

/**
 * Moves tickets through the agents: intake → coding → review → awaiting approval.
 *
 * It adds jobs to the queues and applies what the Python workers report back. Job ids are built from
 * the ticket and the run (e.g. "coding-12-1"), so adding the same job twice is a no-op. That lets the
 * API re-add jobs freely after a restart: the database says what should be running, the queues follow.
 */
@Injectable()
export class PipelineService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private readonly tickets: TicketsService,
    @InjectQueue(INTAKE_QUEUE) private readonly intakeQueue: Queue<IntakeJob>,
    @InjectQueue(CODING_QUEUE) private readonly codingQueue: Queue<CodingJob>,
    @InjectQueue(REVIEW_QUEUE) private readonly reviewQueue: Queue<ReviewJob>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.recover();
  }

  // ---- Intake ----

  async startIntake(ticket: Pick<Ticket, 'id' | 'siteId' | 'request'>): Promise<void> {
    const run = await this.tickets.countEntries(ticket.id, 'intake');
    await this.intakeQueue.add(
      'start',
      { ticketId: ticket.id, threadId: intakeThread(ticket.id, run), action: 'start', siteId: ticket.siteId, request: ticket.request },
      { jobId: `intake-${ticket.id}-${run}-start` },
    );
  }

  async answer(user: User, ticketId: number, answer: string): Promise<void> {
    const { questionNumber } = await this.tickets.recordAnswer(user, ticketId, answer);
    await this.addAnswerJob(ticketId, answer, questionNumber);
  }

  private async addAnswerJob(ticketId: number, answer: string, questionNumber: number): Promise<void> {
    const run = await this.tickets.countEntries(ticketId, 'intake');
    await this.intakeQueue.add(
      'answer',
      { ticketId, threadId: intakeThread(ticketId, run), action: 'answer', answer, questionNumber },
      { jobId: `intake-${ticketId}-${run}-answer-${questionNumber}` },
    );
  }

  // ---- Coding and review ----

  /** Starts the next pending ticket of a site, if the site is free. Call it whenever a site may have become free. */
  async dispatch(siteId: string): Promise<void> {
    const ticket = await this.tickets.claimNextForCoding(siteId);
    if (ticket) await this.addCodingJob(ticket);
  }

  private async addCodingJob(ticket: Ticket): Promise<void> {
    const run = await this.tickets.countEntries(ticket.id, 'in_progress');
    await this.codingQueue.add(
      'code',
      {
        ticketId: ticket.id,
        siteId: ticket.siteId,
        summary: ticket.summary ?? ticket.request,
        details: ticket.details ?? ticket.request,
        changeType: ticket.changeType,
        target: ticket.target,
        acceptanceCriteria: ticket.acceptanceCriteria ?? [],
      },
      { jobId: `coding-${ticket.id}-${run}` },
    );
  }

  private async addReviewJob(ticket: Ticket): Promise<void> {
    const run = await this.tickets.countEntries(ticket.id, 'in_review');
    await this.reviewQueue.add('review', { ticketId: ticket.id, siteId: ticket.siteId }, { jobId: `review-${ticket.id}-${run}` });
  }

  /** Follow-up after the agency changes a status by hand in the panel. */
  async afterManualChange(ticket: Pick<Ticket, 'id' | 'siteId' | 'request' | 'status'>): Promise<void> {
    if (ticket.status === 'intake') await this.startIntake(ticket);
    // The change may have queued this ticket or freed its site.
    await this.dispatch(ticket.siteId);
  }

  // ---- Reports from the workers ----

  async handleReport(report: AgentReport): Promise<void> {
    if (report.stage === 'reindex') {
      this.logger.log(`Reindex job ${report.jobId}: ${JSON.stringify(report.result)}`);
      return;
    }

    const ticketId = report.ticketId!;
    const failure = isAttemptFailure(report.result) ? report.result : null;
    if (failure?.status === 'retrying') {
      await this.tickets.addNote(
        ticketId,
        SYSTEM,
        `${STAGE_NAMES[report.stage]} attempt ${report.attempt} of ${report.attempts} failed. Trying again shortly.`,
        { stage: report.stage, error: failure.error },
      );
      return;
    }

    switch (report.stage) {
      case 'intake': {
        const result = report.result;
        if (isAttemptFailure(result)) {
          await this.tickets.changeStatus(
            ticketId,
            'needs_human',
            SYSTEM,
            'The intake assistant could not finish, so a person from the agency will take over.',
            { onlyFrom: 'intake', data: { error: result.error } },
          );
        } else {
          await this.saveIntake(ticketId, result);
        }
        return;
      }

      case 'coding': {
        const result = report.result;
        if (isAttemptFailure(result)) {
          await this.failStage(ticketId, 'in_progress', 'The change could not be made.', result.error);
        } else if (result.status === 'needs_human') {
          // The coder stopped on purpose (not allowed, build still failing, too big): a person takes over.
          await this.tickets.changeStatus(ticketId, 'needs_human', CODER, 'This change needs a person from the agency.', {
            onlyFrom: 'in_progress',
            data: { reasoning: result.message, error: result.buildOutput ?? undefined, usage: result.usage },
          });
          await this.dispatch((await this.tickets.findById(ticketId)).siteId);
        } else if (
          await this.tickets.changeStatus(ticketId, 'in_review', CODER, 'The change is made and is being checked.', {
            onlyFrom: 'in_progress',
            // The technical summary (files, values) is for the agency; clients see the message above.
            data: { reasoning: result.summary, usage: result.usage, seconds: result.seconds, buildRounds: result.buildRounds },
            fields: { branch: result.branch, commitSha: result.commit, changedFiles: result.files },
          })
        ) {
          await this.addReviewJob(await this.tickets.findById(ticketId));
        }
        return;
      }

      case 'review': {
        const result = report.result;
        if (isAttemptFailure(result)) {
          await this.failStage(ticketId, 'in_review', 'The change could not be reviewed.', result.error);
        } else {
          await this.tickets.changeStatus(ticketId, 'awaiting_approval', { type: 'agent', agent: 'reviewer' }, result.summary, {
            onlyFrom: 'in_review',
          });
          await this.dispatch((await this.tickets.findById(ticketId)).siteId);
        }
      }
    }
  }

  private async failStage(ticketId: number, from: 'in_progress' | 'in_review', message: string, error: string): Promise<void> {
    await this.tickets.changeStatus(ticketId, 'failed', SYSTEM, `${message} The agency has been notified.`, {
      onlyFrom: from,
      data: { error },
    });
    await this.dispatch((await this.tickets.findById(ticketId)).siteId);
  }

  private async saveIntake(ticketId: number, result: IntakeResult): Promise<void> {
    const intake: Actor = { type: 'agent', agent: 'intake' };
    const trace = { reasoning: result.reasoning ?? null, sources: result.sources ?? [], usage: result.usage ?? {} };
    // onlyFrom / the intake check in recordQuestion: if the agency moved the ticket meanwhile, the result is dropped.
    switch (result.status) {
      case 'question':
        await this.tickets.recordQuestion(ticketId, { question: result.question, number: result.number, max: result.max }, trace);
        return;
      case 'ticket': {
        const { ticket } = result;
        const moved = await this.tickets.changeStatus(ticketId, 'pending', intake, `Your request is clear: ${ticket.summary}`, {
          onlyFrom: 'intake',
          data: trace,
          fields: {
            summary: ticket.summary,
            changeType: ticket.change_type,
            target: ticket.target,
            details: ticket.details,
            acceptanceCriteria: ticket.acceptance_criteria,
            risk: ticket.risk,
          },
        });
        if (moved) await this.dispatch((await this.tickets.findById(ticketId)).siteId);
        return;
      }
      case 'out_of_scope':
        await this.tickets.changeStatus(ticketId, 'needs_human', intake, result.message, {
          onlyFrom: 'intake',
          data: trace,
          fields: { changeType: 'out_of_scope' },
        });
        return;
      case 'needs_human':
        await this.tickets.changeStatus(ticketId, 'needs_human', intake, result.message, { onlyFrom: 'intake', data: trace });
    }
  }

  // ---- Restart safety ----

  /**
   * Re-adds the job every in-flight ticket needs and starts waiting tickets. Jobs that already exist
   * are left alone (same job id), so this only fills gaps, e.g. a job lost because the API stopped
   * between saving a ticket and adding its job.
   */
  private async recover(): Promise<void> {
    for (const ticket of await this.tickets.findInFlight()) {
      if (ticket.status === 'in_progress') await this.addCodingJob(ticket);
      else if (ticket.status === 'in_review') await this.addReviewJob(ticket);
      else if (!ticket.pendingQuestion) {
        const answer = await this.tickets.unprocessedAnswer(ticket.id);
        if (answer) await this.addAnswerJob(ticket.id, answer.answer, answer.number);
        else await this.startIntake(ticket);
      }
    }
    for (const siteId of await this.tickets.sitesWithPendingTickets()) {
      await this.dispatch(siteId);
    }
  }
}

function isAttemptFailure(result: { status: string }): result is AttemptFailure {
  return result.status === 'retrying' || result.status === 'failed';
}

/** One LangGraph thread per intake run; sending a ticket back to intake starts a new conversation. */
function intakeThread(ticketId: number, run: number): string {
  return `ticket-${ticketId}-intake-${run}`;
}

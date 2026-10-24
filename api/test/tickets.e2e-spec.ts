import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Queue, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { DataSource } from 'typeorm';
import type { AgentReport, IntakeJob, IntakeResult } from '../src/agents/agent-results.js';
import { AppModule } from '../src/app.module.js';
import { AGENT_RESULTS_QUEUE, CODING_QUEUE, INTAKE_QUEUE, REINDEX_QUEUE, REVIEW_QUEUE } from '../src/queues/queues.js';
import { TicketsService } from '../src/tickets/tickets.service.js';
import type { UserView } from '../src/users/users.controller.js';
import { resetTestDatabase, resetTestRedis, TEST_DATABASE_URL, TEST_REDIS_URL } from './setup-database.js';

type Report = Omit<AgentReport, 'stage' | 'result'> & { stage: string; result: unknown };

/**
 * Stands in for the Python workers: takes jobs from the real queues and reports scripted results.
 * Intake jobs with no scripted reply report nothing (as if the agent were still thinking).
 * Coding and review jobs succeed at once, unless held (`holdCoding`) or scripted to fail.
 */
class FakeWorkers {
  intakeReplies: IntakeResult[] = [];
  intakeJobs: IntakeJob[] = [];
  holdCoding = false;
  failNextCoding = false;
  heldCoding = new Map<number, Job>();
  private readonly connection = { url: TEST_REDIS_URL };
  private readonly results = new Queue(AGENT_RESULTS_QUEUE, { connection: this.connection });
  private readonly workers: Worker[] = [];

  start(): void {
    this.listen(INTAKE_QUEUE, async (job: Job<IntakeJob>) => {
      this.intakeJobs.push(job.data);
      const reply = this.intakeReplies.shift();
      if (reply) await this.report(job, 'intake', reply);
    });
    this.listen(CODING_QUEUE, async (job: Job<{ ticketId: number }>) => {
      if (this.failNextCoding) {
        this.failNextCoding = false;
        await this.report(job, 'coding', { status: 'retrying', error: 'RuntimeError: provider down' }, 1);
        await this.report(job, 'coding', { status: 'failed', error: 'RuntimeError: provider down' }, 2);
      } else if (this.holdCoding) {
        this.heldCoding.set(job.data.ticketId, job);
      } else {
        await this.report(job, 'coding', { status: 'done', summary: 'Changed the phone number.' });
      }
    });
    this.listen(REVIEW_QUEUE, (job: Job) => this.report(job, 'review', { status: 'approved', summary: 'Looks right.' }));
  }

  async releaseCoding(ticketId: number): Promise<void> {
    const job = this.heldCoding.get(ticketId)!;
    this.heldCoding.delete(ticketId);
    await this.report(job, 'coding', { status: 'done', summary: 'Changed the phone number.' });
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
    await this.results.close();
  }

  private listen(name: string, process: (job: Job) => Promise<void>): void {
    this.workers.push(new Worker(name, process, { connection: this.connection }));
  }

  private async report(job: Job, stage: string, result: unknown, attempt = 1): Promise<void> {
    const report: Report = { stage, jobId: job.id!, ticketId: job.data.ticketId, attempt, attempts: 2, result };
    await this.results.add('result', report, { jobId: `${stage}-${job.id}-${attempt}-${(result as { status: string }).status}` });
  }
}

/** Waits until `check` stops throwing (the pipeline runs through queues, so results arrive a bit later). */
async function eventually<T>(check: () => Promise<T>, timeoutMs = 8000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

describe('Tickets (e2e)', () => {
  let app: INestApplication<App>;
  let sofia: UserView; // Luna Café owner
  let emily: UserView; // BrightSmile Dental owner
  let robert: UserView; // Northside Accounting owner
  let agency: UserView;
  const workers = new FakeWorkers();

  const as = (user: UserView) => ({ 'X-Demo-User-Id': user.id });
  const createAs = async (user: UserView, siteId: string, text: string) =>
    (await request(app.getHttpServer()).post('/api/tickets').set(as(user)).send({ siteId, request: text }).expect(201)).body
      .id as number;
  const getAs = async (user: UserView, id: number) =>
    (await request(app.getHttpServer()).get(`/api/tickets/${id}`).set(as(user)).expect(200)).body;
  const statusOf = async (id: number) => (await getAs(agency, id)).status as string;
  const ready = (summary: string): IntakeResult => ({
    status: 'ticket',
    ticket: {
      summary,
      change_type: 'content_update',
      target: { page: 'global', section: 'Footer' },
      details: 'Change 618 123 4567 to 618 765 4321',
      acceptance_criteria: ['The footer shows 618 765 4321'],
      risk: 'low',
    },
    reasoning: 'The client gave the new number.',
    sources: ['Plan › What the plan includes'],
  });

  beforeAll(async () => {
    await resetTestDatabase();
    await resetTestRedis();
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.REDIS_URL = TEST_REDIS_URL;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    workers.start();

    const users = (await request(app.getHttpServer()).get('/api/demo-users').expect(200)).body as UserView[];
    sofia = users.find((user) => user.email === 'sofia@lunacafe.example')!;
    emily = users.find((user) => user.email === 'emily@brightsmile.example')!;
    robert = users.find((user) => user.email === 'robert@northside-accounting.example')!;
    agency = users.find((user) => user.role === 'agency')!;
  });

  afterAll(async () => {
    await workers.close();
    await app.close();
  });

  it('lists the four demo users', async () => {
    const response = await request(app.getHttpServer()).get('/api/demo-users').expect(200);
    expect(response.body).toHaveLength(4);
  });

  it('rejects requests without a signed-in user', async () => {
    await request(app.getHttpServer()).get('/api/tickets').expect(401);
  });

  it('shows clients only their own sites', async () => {
    const response = await request(app.getHttpServer()).get('/api/sites').set(as(sofia)).expect(200);
    expect(response.body.map((site: { id: string }) => site.id)).toEqual(['luna-cafe']);

    const all = await request(app.getHttpServer()).get('/api/sites').set(as(agency)).expect(200);
    expect(all.body).toHaveLength(3);
  });

  it('creates a ticket in "intake" with a "created" event, and queues its intake', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/tickets')
      .set(as(sofia))
      .send({ siteId: 'luna-cafe', request: '  Change the phone number in the footer  ' })
      .expect(201);

    expect(created.body).toMatchObject({
      siteId: 'luna-cafe',
      status: 'intake',
      request: 'Change the phone number in the footer',
      createdBy: { name: 'Sofia Ramirez' },
    });

    const detail = await getAs(sofia, created.body.id);
    expect(detail.events).toHaveLength(1);
    expect(detail.events[0]).toMatchObject({ type: 'created', toStatus: 'intake', actor: { type: 'user', name: 'Sofia Ramirez' } });
    expect(detail.allowedTransitions).toEqual([]);

    await eventually(async () =>
      expect(workers.intakeJobs.at(-1)).toEqual({
        ticketId: created.body.id,
        threadId: `ticket-${created.body.id}-intake-1`,
        action: 'start',
        siteId: 'luna-cafe',
        request: 'Change the phone number in the footer',
      }),
    );
  });

  it("does not let a client request changes to someone else's site", async () => {
    await request(app.getHttpServer())
      .post('/api/tickets')
      .set(as(sofia))
      .send({ siteId: 'brightsmile-dental', request: 'Add a new section' })
      .expect(403);
  });

  it('rejects invalid bodies and unknown fields', async () => {
    await request(app.getHttpServer()).post('/api/tickets').set(as(sofia)).send({ siteId: 'luna-cafe', request: 'hi' }).expect(400);
    await request(app.getHttpServer())
      .post('/api/tickets')
      .set(as(sofia))
      .send({ siteId: 'luna-cafe', request: 'Change the phone', status: 'deployed' })
      .expect(400);
  });

  it("hides other clients' tickets", async () => {
    const id = await createAs(emily, 'brightsmile-dental', 'Update our Friday hours');

    await request(app.getHttpServer()).get(`/api/tickets/${id}`).set(as(sofia)).expect(404);

    const sofiasList = await request(app.getHttpServer()).get('/api/tickets').set(as(sofia)).expect(200);
    expect(sofiasList.body.every((ticket: { siteId: string }) => ticket.siteId === 'luna-cafe')).toBe(true);

    const agencyList = await request(app.getHttpServer()).get('/api/tickets').set(as(agency)).expect(200);
    expect(agencyList.body.length).toBeGreaterThanOrEqual(2);
  });

  it('lets only the agency change status, following the allowed transitions', async () => {
    const id = await createAs(sofia, 'luna-cafe', 'Add a testimonials section');

    await request(app.getHttpServer()).patch(`/api/tickets/${id}/status`).set(as(sofia)).send({ status: 'needs_human' }).expect(403);

    const moved = await request(app.getHttpServer())
      .patch(`/api/tickets/${id}/status`)
      .set(as(agency))
      .send({ status: 'needs_human', message: 'I will handle this one.' })
      .expect(200);
    expect(moved.body.status).toBe('needs_human');
    expect(moved.body.allowedTransitions).toEqual(['intake', 'pending', 'failed']);
    expect(moved.body.events.at(-1)).toMatchObject({
      type: 'status_changed',
      fromStatus: 'intake',
      toStatus: 'needs_human',
      message: 'I will handle this one.',
      actor: { name: 'Agency team' },
    });

    await request(app.getHttpServer()).patch(`/api/tickets/${id}/status`).set(as(agency)).send({ status: 'deployed' }).expect(409);
  });

  it('keeps the audit trail append-only', async () => {
    const dataSource = app.get<DataSource>(getDataSourceToken());
    await expect(dataSource.query(`UPDATE ticket_events SET message = 'edited'`)).rejects.toThrow(/append-only/);
    await expect(dataSource.query(`DELETE FROM ticket_events`)).rejects.toThrow(/append-only/);
  });

  describe('intake', () => {
    it('asks a question, turns the answer into a ticket, and runs it through coding and review', async () => {
      workers.intakeReplies.push({ status: 'question', question: 'What is the new phone number?', number: 1, max: 3 });
      const id = await createAs(sofia, 'luna-cafe', 'Change the phone number');

      const asked = await eventually(async () => {
        const ticket = await getAs(sofia, id);
        expect(ticket.pendingQuestion).toEqual({ question: 'What is the new phone number?', number: 1, max: 3 });
        return ticket;
      });
      expect(asked.events.at(-1)).toMatchObject({ type: 'agent_question', actor: { type: 'agent', name: 'intake agent' } });

      // Only the client who owns the site answers.
      await request(app.getHttpServer()).post(`/api/tickets/${id}/answer`).set(as(agency)).send({ answer: 'x' }).expect(403);
      await request(app.getHttpServer()).post(`/api/tickets/${id}/answer`).set(as(emily)).send({ answer: 'x' }).expect(404);

      workers.intakeReplies.push(ready('Update the phone number in the footer'));
      const answered = await request(app.getHttpServer())
        .post(`/api/tickets/${id}/answer`)
        .set(as(sofia))
        .send({ answer: ' 618 765 4321 ' })
        .expect(201);
      expect(answered.body.pendingQuestion).toBeNull();
      expect(answered.body.events.at(-1)).toMatchObject({ type: 'client_answer', message: '618 765 4321' });

      const done = await eventually(async () => {
        const ticket = await getAs(sofia, id);
        expect(ticket.status).toBe('awaiting_approval');
        return ticket;
      });
      expect(workers.intakeJobs.at(-1)).toMatchObject({ action: 'answer', answer: '618 765 4321', questionNumber: 1 });
      expect(done).toMatchObject({
        summary: 'Update the phone number in the footer',
        changeType: 'content_update',
        target: { page: 'global', section: 'Footer' },
        risk: 'low',
      });
      const steps = done.events
        .filter((event: { type: string }) => event.type === 'status_changed')
        .map((event: { toStatus: string; actor: { name: string } }) => `${event.toStatus} by ${event.actor.name}`);
      expect(steps).toEqual([
        'pending by intake agent',
        'in_progress by System',
        'in_review by coder agent',
        'awaiting_approval by reviewer agent',
      ]);
      const queued = done.events.find((event: { toStatus: string }) => event.toStatus === 'pending');
      expect(queued).toMatchObject({ sources: ['Plan › What the plan includes'], reasoning: null }); // reasoning is agency-only
      const forAgency = (await getAs(agency, id)).events.find((event: { toStatus: string }) => event.toStatus === 'pending');
      expect(forAgency.reasoning).toBe('The client gave the new number.');

      await request(app.getHttpServer()).post(`/api/tickets/${id}/answer`).set(as(sofia)).send({ answer: 'again' }).expect(409);
    });

    it('hands out-of-scope requests to the agency, citing the plan', async () => {
      workers.intakeReplies.push({
        status: 'out_of_scope',
        message: 'Online ordering is not included in your Basic plan.',
        sources: ['Luna Café plan: Basic › What the plan does not include'],
      });
      const id = await createAs(sofia, 'luna-cafe', 'Let customers order online');

      const ticket = await eventually(async () => {
        const current = await getAs(sofia, id);
        expect(current.status).toBe('needs_human');
        return current;
      });
      expect(ticket.changeType).toBe('out_of_scope');
      expect(ticket.events.at(-1)).toMatchObject({ message: 'Online ordering is not included in your Basic plan.' });
    });

    it('starts a new conversation when the agency sends a ticket back to intake', async () => {
      const id = await createAs(sofia, 'luna-cafe', 'Change the opening hours');
      await request(app.getHttpServer()).patch(`/api/tickets/${id}/status`).set(as(agency)).send({ status: 'needs_human' }).expect(200);
      await request(app.getHttpServer()).patch(`/api/tickets/${id}/status`).set(as(agency)).send({ status: 'intake' }).expect(200);

      await eventually(async () => expect(workers.intakeJobs.at(-1)).toMatchObject({ threadId: `ticket-${id}-intake-2` }));
    });

    it("drops an agent's result when the agency already moved the ticket", async () => {
      const id = await createAs(sofia, 'luna-cafe', 'Change the phone number please');
      await request(app.getHttpServer()).patch(`/api/tickets/${id}/status`).set(as(agency)).send({ status: 'needs_human' }).expect(200);

      expect(await app.get(TicketsService).recordQuestion(id, { question: 'Late question?', number: 1, max: 3 })).toBe(false);
      expect((await getAs(agency, id)).pendingQuestion).toBeNull();
    });
  });

  describe('pipeline', () => {
    it('codes only one ticket per site at a time, in order', async () => {
      workers.holdCoding = true;
      workers.intakeReplies.push(ready('First change'));
      const first = await createAs(robert, 'northside-accounting', 'First change please');
      await eventually(async () => expect(await statusOf(first)).toBe('in_progress'));

      workers.intakeReplies.push(ready('Second change'));
      const second = await createAs(robert, 'northside-accounting', 'Second change please');
      await eventually(async () => expect(await statusOf(second)).toBe('pending'));

      // Another site is not blocked.
      workers.intakeReplies.push(ready('Other site'));
      const other = await createAs(emily, 'brightsmile-dental', 'Other site change');
      await eventually(async () => expect(await statusOf(other)).toBe('in_progress'));
      expect(await statusOf(second)).toBe('pending');

      workers.holdCoding = false;
      await workers.releaseCoding(first);
      await eventually(async () => expect(await statusOf(first)).toBe('awaiting_approval'));
      await eventually(async () => expect(await statusOf(second)).toBe('awaiting_approval'));
      await workers.releaseCoding(other);
      await eventually(async () => expect(await statusOf(other)).toBe('awaiting_approval'));
    });

    it('shows retries in the history and fails the ticket after the last attempt', async () => {
      workers.failNextCoding = true;
      workers.intakeReplies.push(ready('A change that keeps failing'));
      const id = await createAs(robert, 'northside-accounting', 'A change that keeps failing');

      const failed = await eventually(async () => {
        const ticket = await getAs(agency, id);
        expect(ticket.status).toBe('failed');
        return ticket;
      });
      expect(failed.events.slice(-2)).toMatchObject([
        { type: 'note', message: 'Coding attempt 1 of 2 failed. Trying again shortly.', error: 'RuntimeError: provider down' },
        { type: 'status_changed', toStatus: 'failed', actor: { type: 'system' } },
      ]);
      // The technical error is for the agency only.
      expect((await getAs(robert, id)).events.at(-1).error).toBeNull();

      // Sending it back to "pending" codes it again (and the site is free, so right away).
      await request(app.getHttpServer()).patch(`/api/tickets/${id}/status`).set(as(agency)).send({ status: 'pending' }).expect(200);
      await eventually(async () => expect(await statusOf(id)).toBe('awaiting_approval'));
    });

    it('queues one reindex per site at a time, for the agency only', async () => {
      await request(app.getHttpServer()).post('/api/sites/luna-cafe/reindex').set(as(sofia)).expect(403);
      await request(app.getHttpServer()).post('/api/sites/luna-cafe/reindex').set(as(agency)).expect(202);
      await request(app.getHttpServer()).post('/api/sites/luna-cafe/reindex').set(as(agency)).expect(202);

      const queue = new Queue(REINDEX_QUEUE, { connection: { url: TEST_REDIS_URL } });
      const waiting = await queue.getWaiting();
      await queue.close();
      expect(waiting.map((job) => job.data)).toEqual([{ siteId: 'luna-cafe' }]); // the second request was deduplicated
    });
  });
});

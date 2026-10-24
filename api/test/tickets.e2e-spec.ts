import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { DataSource } from 'typeorm';
import { AgentsClient } from '../src/agents/agents.client.js';
import type { IntakeResult } from '../src/agents/agents.client.js';
import { AppModule } from '../src/app.module.js';
import { IntakeService } from '../src/tickets/intake.service.js';
import { TicketsService } from '../src/tickets/tickets.service.js';
import type { UserView } from '../src/users/users.controller.js';
import { resetTestDatabase, TEST_DATABASE_URL } from './setup-database.js';

/** Stands in for the Python agents service. With no scripted reply, a call never finishes (the ticket stays in intake). */
class FakeAgents {
  replies: (IntakeResult | Error)[] = [];
  calls: string[] = [];

  startIntake(ticketId: number, _siteId: string, text: string): Promise<IntakeResult> {
    this.calls.push(`start ${ticketId}: ${text}`);
    return this.reply();
  }

  answerIntake(ticketId: number, answer: string): Promise<IntakeResult> {
    this.calls.push(`answer ${ticketId}: ${answer}`);
    return this.reply();
  }

  private reply(): Promise<IntakeResult> {
    const next = this.replies.shift();
    if (!next) return new Promise(() => {});
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }
}

describe('Tickets (e2e)', () => {
  let app: INestApplication<App>;
  let sofia: UserView; // Luna Café owner
  let emily: UserView; // BrightSmile Dental owner
  let agency: UserView;
  let intake: IntakeService;
  const agents = new FakeAgents();

  const as = (user: UserView) => ({ 'X-Demo-User-Id': user.id });

  beforeAll(async () => {
    await resetTestDatabase();
    process.env.DATABASE_URL = TEST_DATABASE_URL;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AgentsClient)
      .useValue(agents)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    intake = app.get(IntakeService);

    const users = (await request(app.getHttpServer()).get('/api/demo-users').expect(200)).body as UserView[];
    sofia = users.find((user) => user.email === 'sofia@lunacafe.example')!;
    emily = users.find((user) => user.email === 'emily@brightsmile.example')!;
    agency = users.find((user) => user.role === 'agency')!;
  });

  afterAll(async () => {
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

  it('creates a ticket in "intake" with a "created" event', async () => {
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

    const detail = await request(app.getHttpServer()).get(`/api/tickets/${created.body.id}`).set(as(sofia)).expect(200);
    expect(detail.body.events).toHaveLength(1);
    expect(detail.body.events[0]).toMatchObject({ type: 'created', toStatus: 'intake', actor: { type: 'user', name: 'Sofia Ramirez' } });
    expect(detail.body.allowedTransitions).toEqual([]);
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
    const created = await request(app.getHttpServer())
      .post('/api/tickets')
      .set(as(emily))
      .send({ siteId: 'brightsmile-dental', request: 'Update our Friday hours' })
      .expect(201);

    await request(app.getHttpServer()).get(`/api/tickets/${created.body.id}`).set(as(sofia)).expect(404);

    const sofiasList = await request(app.getHttpServer()).get('/api/tickets').set(as(sofia)).expect(200);
    expect(sofiasList.body.every((ticket: { siteId: string }) => ticket.siteId === 'luna-cafe')).toBe(true);

    const agencyList = await request(app.getHttpServer()).get('/api/tickets').set(as(agency)).expect(200);
    expect(agencyList.body.length).toBeGreaterThanOrEqual(2);
  });

  it('lets only the agency change status, following the allowed transitions', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/tickets')
      .set(as(sofia))
      .send({ siteId: 'luna-cafe', request: 'Add a testimonials section' })
      .expect(201);
    const id = created.body.id as number;

    await request(app.getHttpServer()).patch(`/api/tickets/${id}/status`).set(as(sofia)).send({ status: 'pending' }).expect(403);

    const moved = await request(app.getHttpServer())
      .patch(`/api/tickets/${id}/status`)
      .set(as(agency))
      .send({ status: 'pending', message: 'Looks clear, queueing it.' })
      .expect(200);
    expect(moved.body.status).toBe('pending');
    expect(moved.body.allowedTransitions).toEqual(['in_progress', 'needs_human', 'failed']);
    expect(moved.body.events.at(-1)).toMatchObject({
      type: 'status_changed',
      fromStatus: 'intake',
      toStatus: 'pending',
      message: 'Looks clear, queueing it.',
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
    const createAs = async (user: UserView, siteId: string, text: string) =>
      (await request(app.getHttpServer()).post('/api/tickets').set(as(user)).send({ siteId, request: text }).expect(201))
        .body.id as number;
    const getAs = async (user: UserView, id: number) =>
      (await request(app.getHttpServer()).get(`/api/tickets/${id}`).set(as(user)).expect(200)).body;

    it('asks the client a question, then turns the answer into a ticket', async () => {
      agents.replies.push({ status: 'question', question: 'What is the new phone number?', number: 1, max: 3 });
      const id = await createAs(sofia, 'luna-cafe', 'Change the phone number');
      await intake.settled(id);

      let ticket = await getAs(sofia, id);
      expect(ticket.status).toBe('intake');
      expect(ticket.pendingQuestion).toEqual({ question: 'What is the new phone number?', number: 1, max: 3 });
      expect(ticket.events.at(-1)).toMatchObject({ type: 'agent_question', actor: { type: 'agent', name: 'intake agent' } });

      // Only the client who owns the site answers.
      await request(app.getHttpServer()).post(`/api/tickets/${id}/answer`).set(as(agency)).send({ answer: 'x' }).expect(403);
      await request(app.getHttpServer()).post(`/api/tickets/${id}/answer`).set(as(emily)).send({ answer: 'x' }).expect(404);

      agents.replies.push({
        status: 'ticket',
        ticket: {
          summary: 'Update the phone number in the footer',
          change_type: 'content_update',
          target: { page: 'global', section: 'Footer' },
          details: 'Change 618 123 4567 to 618 765 4321',
          acceptance_criteria: ['The footer shows 618 765 4321'],
          risk: 'low',
        },
        reasoning: 'The client gave the new number.',
        sources: ['Luna Café plan: Basic › What the plan includes'],
      });
      const answered = await request(app.getHttpServer())
        .post(`/api/tickets/${id}/answer`)
        .set(as(sofia))
        .send({ answer: ' 618 765 4321 ' })
        .expect(201);
      expect(answered.body.pendingQuestion).toBeNull();
      expect(answered.body.events.at(-1)).toMatchObject({ type: 'client_answer', message: '618 765 4321' });
      expect(agents.calls.at(-1)).toBe(`answer ${id}: 618 765 4321`);

      await intake.settled(id);
      ticket = await getAs(sofia, id);
      expect(ticket).toMatchObject({
        status: 'pending',
        summary: 'Update the phone number in the footer',
        changeType: 'content_update',
        target: { page: 'global', section: 'Footer' },
        acceptanceCriteria: ['The footer shows 618 765 4321'],
        risk: 'low',
      });
      expect(ticket.events.at(-1)).toMatchObject({
        type: 'status_changed',
        toStatus: 'pending',
        sources: ['Luna Café plan: Basic › What the plan includes'],
        reasoning: null, // internal, hidden from the client
      });
      expect((await getAs(agency, id)).events.at(-1).reasoning).toBe('The client gave the new number.');

      await request(app.getHttpServer()).post(`/api/tickets/${id}/answer`).set(as(sofia)).send({ answer: 'again' }).expect(409);
    });

    it('hands out-of-scope requests to the agency, citing the plan', async () => {
      agents.replies.push({
        status: 'out_of_scope',
        message: 'Online ordering is not included in your Basic plan.',
        sources: ['Luna Café plan: Basic › What the plan does not include'],
      });
      const id = await createAs(sofia, 'luna-cafe', 'Let customers order online');
      await intake.settled(id);

      const ticket = await getAs(sofia, id);
      expect(ticket).toMatchObject({ status: 'needs_human', changeType: 'out_of_scope' });
      expect(ticket.events.at(-1)).toMatchObject({ message: 'Online ordering is not included in your Basic plan.' });
    });

    it('hands off to a person when the agents service fails, and can run again', async () => {
      agents.replies.push(new Error('Agents service answered 500'));
      const id = await createAs(sofia, 'luna-cafe', 'Change the opening hours');
      await intake.settled(id);

      const ticket = await getAs(agency, id);
      expect(ticket.status).toBe('needs_human');
      expect(ticket.events.at(-1)).toMatchObject({ actor: { type: 'system' }, toStatus: 'needs_human' });

      await request(app.getHttpServer()).patch(`/api/tickets/${id}/status`).set(as(agency)).send({ status: 'intake' }).expect(200);
      expect(agents.calls.at(-1)).toBe(`start ${id}: Change the opening hours`);
    });

    it("drops an agent's result when the agency already moved the ticket", async () => {
      const id = await createAs(sofia, 'luna-cafe', 'Change the phone number please');
      await request(app.getHttpServer()).patch(`/api/tickets/${id}/status`).set(as(agency)).send({ status: 'needs_human' }).expect(200);

      expect(await app.get(TicketsService).recordQuestion(id, { question: 'Late question?', number: 1, max: 3 })).toBe(false);
      expect((await getAs(agency, id)).pendingQuestion).toBeNull();
    });
  });
});

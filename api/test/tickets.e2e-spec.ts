import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import type { UserView } from '../src/users/users.controller.js';
import { resetTestDatabase, TEST_DATABASE_URL } from './setup-database.js';

describe('Tickets (e2e)', () => {
  let app: INestApplication<App>;
  let sofia: UserView; // Luna Café owner
  let emily: UserView; // BrightSmile Dental owner
  let agency: UserView;

  const as = (user: UserView) => ({ 'X-Demo-User-Id': user.id });

  beforeAll(async () => {
    await resetTestDatabase();
    process.env.DATABASE_URL = TEST_DATABASE_URL;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

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
});

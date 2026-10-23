import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1761148800000 implements MigrationInterface {
  name = 'InitialSchema1761148800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE clients (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        plan text NOT NULL CHECK (plan IN ('basic', 'standard', 'premium')),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        email text NOT NULL UNIQUE,
        role text NOT NULL CHECK (role IN ('client', 'agency')),
        client_id uuid REFERENCES clients (id),
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK ((role = 'client') = (client_id IS NOT NULL))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE sites (
        id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]*$'),
        name text NOT NULL,
        client_id uuid NOT NULL REFERENCES clients (id),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE tickets (
        id serial PRIMARY KEY,
        site_id text NOT NULL REFERENCES sites (id),
        created_by uuid NOT NULL REFERENCES users (id),
        request text NOT NULL,
        status text NOT NULL DEFAULT 'intake' CHECK (status IN (
          'intake', 'pending', 'in_progress', 'in_review',
          'awaiting_approval', 'deployed', 'failed', 'needs_human'
        )),
        summary text,
        change_type text CHECK (change_type IN (
          'content_update', 'style_change', 'new_section', 'image_change', 'out_of_scope'
        )),
        target jsonb,
        details text,
        acceptance_criteria jsonb,
        risk text CHECK (risk IN ('low', 'medium', 'high')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX tickets_site_id_idx ON tickets (site_id)`);
    await queryRunner.query(`CREATE INDEX tickets_status_idx ON tickets (status)`);

    await queryRunner.query(`
      CREATE TABLE ticket_events (
        id bigserial PRIMARY KEY,
        ticket_id integer NOT NULL REFERENCES tickets (id),
        type text NOT NULL CHECK (type IN ('created', 'status_changed', 'note')),
        actor_type text NOT NULL CHECK (actor_type IN ('user', 'agent', 'system')),
        actor_user_id uuid REFERENCES users (id),
        actor_agent text,
        from_status text,
        to_status text,
        message text,
        data jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK ((actor_type = 'user') = (actor_user_id IS NOT NULL)),
        CHECK ((actor_type = 'agent') = (actor_agent IS NOT NULL))
      )
    `);
    await queryRunner.query(`CREATE INDEX ticket_events_ticket_id_idx ON ticket_events (ticket_id, created_at)`);

    // The audit trail is append-only: nobody (not even the API) can edit or delete history.
    await queryRunner.query(`
      CREATE FUNCTION ticket_events_append_only() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'ticket_events is append-only';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER ticket_events_no_update_or_delete
      BEFORE UPDATE OR DELETE ON ticket_events
      FOR EACH ROW EXECUTE FUNCTION ticket_events_append_only()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE ticket_events`);
    await queryRunner.query(`DROP FUNCTION ticket_events_append_only`);
    await queryRunner.query(`DROP TABLE tickets`);
    await queryRunner.query(`DROP TABLE sites`);
    await queryRunner.query(`DROP TABLE users`);
    await queryRunner.query(`DROP TABLE clients`);
  }
}

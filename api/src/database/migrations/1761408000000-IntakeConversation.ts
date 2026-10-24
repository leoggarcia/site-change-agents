import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Intake Agent's conversation with the client. The full conversation state lives in LangGraph's
 * checkpoint tables (created by the agents service); here we only keep what the panel needs:
 * the question waiting for an answer, and every question and answer in the audit trail.
 */
export class IntakeConversation1761408000000 implements MigrationInterface {
  name = 'IntakeConversation1761408000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE tickets ADD COLUMN pending_question jsonb`);
    await queryRunner.query(`ALTER TABLE ticket_events DROP CONSTRAINT ticket_events_type_check`);
    await queryRunner.query(`
      ALTER TABLE ticket_events ADD CONSTRAINT ticket_events_type_check
      CHECK (type IN ('created', 'status_changed', 'note', 'agent_question', 'client_answer'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE ticket_events DROP CONSTRAINT ticket_events_type_check`);
    await queryRunner.query(`
      ALTER TABLE ticket_events ADD CONSTRAINT ticket_events_type_check
      CHECK (type IN ('created', 'status_changed', 'note'))
    `);
    await queryRunner.query(`ALTER TABLE tickets DROP COLUMN pending_question`);
  }
}

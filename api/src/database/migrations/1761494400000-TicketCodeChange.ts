import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Where the Coder Agent's change lives: its branch, last commit and the files it changed. */
export class TicketCodeChange1761494400000 implements MigrationInterface {
  name = 'TicketCodeChange1761494400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tickets
        ADD COLUMN branch text,
        ADD COLUMN commit_sha text,
        ADD COLUMN changed_files jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE tickets DROP COLUMN branch, DROP COLUMN commit_sha, DROP COLUMN changed_files`);
  }
}

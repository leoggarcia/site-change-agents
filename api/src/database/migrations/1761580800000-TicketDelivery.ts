import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Delivery (Phase 7): the change's pull request, its preview and, once merged, where it is live. */
export class TicketDelivery1761580800000 implements MigrationInterface {
  name = 'TicketDelivery1761580800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tickets
        ADD COLUMN pr_number integer,
        ADD COLUMN pr_url text,
        ADD COLUMN preview_url text,
        ADD COLUMN production_url text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tickets DROP COLUMN pr_number, DROP COLUMN pr_url, DROP COLUMN preview_url, DROP COLUMN production_url`,
    );
  }
}

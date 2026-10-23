import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ProjectSummaries1761235200000 implements MigrationInterface {
  name = 'ProjectSummaries1761235200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Written by the Project Indexer agent (Python). One row per run; the newest row is the current summary.
    await queryRunner.query(`
      CREATE TABLE project_summaries (
        id bigserial PRIMARY KEY,
        site_id text NOT NULL REFERENCES sites (id),
        source_ref text NOT NULL,
        summary jsonb NOT NULL,
        markdown text NOT NULL,
        model text NOT NULL,
        stats jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX project_summaries_site_id_idx ON project_summaries (site_id, created_at DESC)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE project_summaries`);
  }
}

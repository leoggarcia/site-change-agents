import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Written by the Project Indexer agent; the API only reads it. Shape of `summary`: agents/src/change_agents/indexer/schema.py */
@Entity('project_summaries')
export class ProjectSummary {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column('text', { name: 'site_id' })
  siteId: string;

  /** Git commit the summary describes, or "local" when indexed from a local folder. */
  @Column('text', { name: 'source_ref' })
  sourceRef: string;

  @Column('jsonb')
  summary: Record<string, unknown>;

  @Column('text')
  markdown: string;

  @Column('text')
  model: string;

  @Column('jsonb')
  stats: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Site } from '../sites/site.entity.js';
import { User } from '../users/user.entity.js';
import type { TicketStatus } from './ticket-status.js';

export const CHANGE_TYPES = ['content_update', 'style_change', 'new_section', 'image_change', 'out_of_scope'] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export interface TicketTarget {
  page: string;
  section: string;
}

/** A question from the Intake Agent that the client hasn't answered yet. */
export interface PendingQuestion {
  question: string;
  number: number;
  max: number;
}

@Entity('tickets')
export class Ticket {
  @PrimaryGeneratedColumn()
  id: number;

  @Column('text', { name: 'site_id' })
  siteId: string;

  @ManyToOne(() => Site)
  @JoinColumn({ name: 'site_id' })
  site: Relation<Site>;

  @Column('uuid', { name: 'created_by' })
  createdById: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  createdBy: Relation<User>;

  /** The client's original words, kept unchanged. Treated as data, never as instructions. */
  @Column('text')
  request: string;

  @Column('text', { default: 'intake' })
  status: TicketStatus;

  // Structured fields, filled in by the Intake Agent (Phase 3).
  @Column('text', { nullable: true })
  summary: string | null;

  @Column('text', { name: 'change_type', nullable: true })
  changeType: ChangeType | null;

  @Column('jsonb', { nullable: true })
  target: TicketTarget | null;

  @Column('text', { nullable: true })
  details: string | null;

  @Column('jsonb', { name: 'acceptance_criteria', nullable: true })
  acceptanceCriteria: string[] | null;

  @Column('text', { nullable: true })
  risk: RiskLevel | null;

  @Column('jsonb', { name: 'pending_question', nullable: true })
  pendingQuestion: PendingQuestion | null;

  // The Coder Agent's change (Phase 5): reviewed in Phase 6, opened as a pull request in Phase 7.
  @Column('text', { nullable: true })
  branch: string | null;

  @Column('text', { name: 'commit_sha', nullable: true })
  commitSha: string | null;

  @Column('jsonb', { name: 'changed_files', nullable: true })
  changedFiles: string[] | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

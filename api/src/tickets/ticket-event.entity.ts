import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { User } from '../users/user.entity.js';
import { Ticket } from './ticket.entity.js';
import type { TicketStatus } from './ticket-status.js';

export type TicketEventType = 'created' | 'status_changed' | 'note';
export type ActorType = 'user' | 'agent' | 'system';

/** One entry in a ticket's audit trail. Rows are append-only (enforced by a database trigger). */
@Entity('ticket_events')
export class TicketEvent {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column('int', { name: 'ticket_id' })
  ticketId: number;

  @ManyToOne(() => Ticket)
  @JoinColumn({ name: 'ticket_id' })
  ticket: Relation<Ticket>;

  @Column('text')
  type: TicketEventType;

  @Column('text', { name: 'actor_type' })
  actorType: ActorType;

  @Column('uuid', { name: 'actor_user_id', nullable: true })
  actorUserId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'actor_user_id' })
  actorUser: Relation<User> | null;

  /** Agent name when actorType is "agent", e.g. "intake" or "coder". */
  @Column('text', { name: 'actor_agent', nullable: true })
  actorAgent: string | null;

  @Column('text', { name: 'from_status', nullable: true })
  fromStatus: TicketStatus | null;

  @Column('text', { name: 'to_status', nullable: true })
  toStatus: TicketStatus | null;

  @Column('text', { nullable: true })
  message: string | null;

  @Column('jsonb', { nullable: true })
  data: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

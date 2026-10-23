import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { Client } from '../clients/client.entity.js';

export type UserRole = 'client' | 'agency';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('text')
  name: string;

  @Column('text', { unique: true })
  email: string;

  @Column('text')
  role: UserRole;

  /** Set for client users only; agency staff can see every client. */
  @Column('uuid', { name: 'client_id', nullable: true })
  clientId: string | null;

  @ManyToOne(() => Client, { nullable: true })
  @JoinColumn({ name: 'client_id' })
  client: Relation<Client> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

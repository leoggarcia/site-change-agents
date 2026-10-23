import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { Client } from '../clients/client.entity.js';

@Entity('sites')
export class Site {
  /** Slug that matches the site's GitHub repository name, e.g. "luna-cafe". */
  @PrimaryColumn('text')
  id: string;

  @Column('text')
  name: string;

  @Column('uuid', { name: 'client_id' })
  clientId: string;

  @ManyToOne(() => Client)
  @JoinColumn({ name: 'client_id' })
  client: Relation<Client>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

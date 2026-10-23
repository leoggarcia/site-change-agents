import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export const CLIENT_PLANS = ['basic', 'standard', 'premium'] as const;
export type ClientPlan = (typeof CLIENT_PLANS)[number];

@Entity('clients')
export class Client {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('text')
  name: string;

  @Column('text')
  plan: ClientPlan;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

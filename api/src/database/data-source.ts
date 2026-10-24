import { DataSource } from 'typeorm';
import type { DataSourceOptions } from 'typeorm';
import { Client } from '../clients/client.entity.js';
import { ProjectSummary } from '../sites/project-summary.entity.js';
import { Site } from '../sites/site.entity.js';
import { TicketEvent } from '../tickets/ticket-event.entity.js';
import { Ticket } from '../tickets/ticket.entity.js';
import { User } from '../users/user.entity.js';
import { InitialSchema1761148800000 } from './migrations/1761148800000-InitialSchema.js';
import { ProjectSummaries1761235200000 } from './migrations/1761235200000-ProjectSummaries.js';
import { RagChunks1761321600000 } from './migrations/1761321600000-RagChunks.js';

export const LOCAL_DATABASE_URL = 'postgresql://change_agents:change_agents@localhost:5432/change_agents';

/** Shared by the Nest app, the TypeORM CLI and the seed script. */
export function dataSourceOptions(url = process.env.DATABASE_URL ?? LOCAL_DATABASE_URL): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    entities: [Client, User, Site, Ticket, TicketEvent, ProjectSummary],
    migrations: [InitialSchema1761148800000, ProjectSummaries1761235200000, RagChunks1761321600000],
    synchronize: false,
  };
}

export default new DataSource(dataSourceOptions());

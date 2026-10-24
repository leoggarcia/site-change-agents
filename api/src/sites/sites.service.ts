import { InjectQueue } from '@nestjs/bullmq';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import type { ReindexJob } from '../agents/agent-results.js';
import { REINDEX_QUEUE } from '../queues/queues.js';
import type { User } from '../users/user.entity.js';
import { ProjectSummary } from './project-summary.entity.js';
import { Site } from './site.entity.js';

@Injectable()
export class SitesService {
  constructor(
    @InjectRepository(Site) private readonly sites: Repository<Site>,
    @InjectRepository(ProjectSummary) private readonly summaries: Repository<ProjectSummary>,
    @InjectQueue(REINDEX_QUEUE) private readonly reindexQueue: Queue<ReindexJob>,
  ) {}

  /** Sites the user may see: their own as a client, all of them as agency staff. */
  listFor(user: User): Promise<Site[]> {
    return this.sites.find({
      where: user.role === 'agency' ? {} : { clientId: user.clientId! },
      relations: { client: true },
      order: { name: 'ASC' },
    });
  }

  async getAccessible(user: User, siteId: string): Promise<Site> {
    const site = await this.sites.findOneBy({ id: siteId });
    if (!site) {
      throw new NotFoundException(`Site "${siteId}" not found.`);
    }
    if (user.role !== 'agency' && site.clientId !== user.clientId) {
      throw new ForbiddenException('You can only request changes for your own sites.');
    }
    return site;
  }

  /** Newest summary written by the Project Indexer, or null if the site was never indexed. */
  async latestSummary(user: User, siteId: string): Promise<ProjectSummary | null> {
    if (user.role !== 'agency') {
      throw new ForbiddenException('Only the agency can see project summaries.');
    }
    await this.getAccessible(user, siteId);
    return this.summaries.findOne({ where: { siteId }, order: { createdAt: 'DESC' } });
  }

  /**
   * Queues a RAG re-index of the site. Only changed files are embedded again, so it is cheap.
   * While one reindex of the site is waiting, more requests are dropped (deduplication).
   * From Phase 7 the deploy webhook calls this after every deploy.
   */
  async reindex(user: User, siteId: string): Promise<void> {
    if (user.role !== 'agency') {
      throw new ForbiddenException('Only the agency can re-index a site.');
    }
    await this.getAccessible(user, siteId);
    await this.reindexQueue.add('reindex', { siteId }, { deduplication: { id: `reindex-${siteId}` } });
  }
}

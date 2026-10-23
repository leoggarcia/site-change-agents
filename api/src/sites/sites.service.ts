import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { User } from '../users/user.entity.js';
import { Site } from './site.entity.js';

@Injectable()
export class SitesService {
  constructor(@InjectRepository(Site) private readonly sites: Repository<Site>) {}

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
}

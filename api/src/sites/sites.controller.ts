import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { DemoAuthGuard } from '../auth/demo-auth.guard.js';
import type { User } from '../users/user.entity.js';
import { SitesService } from './sites.service.js';

export interface SiteView {
  id: string;
  name: string;
  clientName: string;
  plan: string;
}

@Controller('sites')
@UseGuards(DemoAuthGuard)
export class SitesController {
  constructor(private readonly sitesService: SitesService) {}

  @Get()
  async list(@CurrentUser() user: User): Promise<SiteView[]> {
    const sites = await this.sitesService.listFor(user);
    return sites.map((site) => ({ id: site.id, name: site.name, clientName: site.client.name, plan: site.client.plan }));
  }
}

import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { DemoAuthGuard } from '../auth/demo-auth.guard.js';
import type { User } from '../users/user.entity.js';
import type { ProjectSummary } from './project-summary.entity.js';
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

  @Get(':id/summary')
  async summary(@CurrentUser() user: User, @Param('id') id: string): Promise<ProjectSummary> {
    const summary = await this.sitesService.latestSummary(user, id);
    if (!summary) {
      throw new NotFoundException('This site has not been indexed yet.');
    }
    return summary;
  }
}

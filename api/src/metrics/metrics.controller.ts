import { Controller, ForbiddenException, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { DemoAuthGuard } from '../auth/demo-auth.guard.js';
import type { User } from '../users/user.entity.js';
import { MetricsService } from './metrics.service.js';
import type { MetricsView } from './metrics.service.js';

@Controller('metrics')
@UseGuards(DemoAuthGuard)
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  overview(@CurrentUser() user: User): Promise<MetricsView> {
    if (user.role !== 'agency') {
      throw new ForbiddenException('Only the agency can see the metrics.');
    }
    return this.metrics.overview();
  }
}

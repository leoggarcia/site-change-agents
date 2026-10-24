import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueuesModule } from '../queues/queues.module.js';
import { UsersModule } from '../users/users.module.js';
import { ProjectSummary } from './project-summary.entity.js';
import { Site } from './site.entity.js';
import { SitesController } from './sites.controller.js';
import { SitesService } from './sites.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Site, ProjectSummary]), UsersModule, QueuesModule],
  controllers: [SitesController],
  providers: [SitesService],
  exports: [SitesService],
})
export class SitesModule {}

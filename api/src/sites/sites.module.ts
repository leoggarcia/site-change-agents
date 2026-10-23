import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module.js';
import { Site } from './site.entity.js';
import { SitesController } from './sites.controller.js';
import { SitesService } from './sites.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Site]), UsersModule],
  controllers: [SitesController],
  providers: [SitesService],
  exports: [SitesService],
})
export class SitesModule {}

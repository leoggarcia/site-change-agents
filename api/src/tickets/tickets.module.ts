import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueuesModule } from '../queues/queues.module.js';
import { SitesModule } from '../sites/sites.module.js';
import { UsersModule } from '../users/users.module.js';
import { TicketEvent } from './ticket-event.entity.js';
import { Ticket } from './ticket.entity.js';
import { AgentResultsProcessor } from './agent-results.processor.js';
import { PipelineService } from './pipeline.service.js';
import { TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Ticket, TicketEvent]), SitesModule, UsersModule, QueuesModule],
  controllers: [TicketsController],
  providers: [TicketsService, PipelineService, AgentResultsProcessor],
  exports: [TicketsService, PipelineService],
})
export class TicketsModule {}

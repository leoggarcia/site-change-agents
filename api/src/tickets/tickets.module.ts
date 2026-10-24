import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentsModule } from '../agents/agents.module.js';
import { SitesModule } from '../sites/sites.module.js';
import { UsersModule } from '../users/users.module.js';
import { TicketEvent } from './ticket-event.entity.js';
import { Ticket } from './ticket.entity.js';
import { IntakeService } from './intake.service.js';
import { TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Ticket, TicketEvent]), SitesModule, UsersModule, AgentsModule],
  controllers: [TicketsController],
  providers: [TicketsService, IntakeService],
  exports: [TicketsService],
})
export class TicketsModule {}

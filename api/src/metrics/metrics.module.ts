import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TicketEvent } from '../tickets/ticket-event.entity.js';
import { Ticket } from '../tickets/ticket.entity.js';
import { UsersModule } from '../users/users.module.js';
import { MetricsController } from './metrics.controller.js';
import { MetricsService } from './metrics.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Ticket, TicketEvent]), UsersModule],
  controllers: [MetricsController],
  providers: [MetricsService],
})
export class MetricsModule {}

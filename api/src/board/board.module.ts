import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueuesModule } from '../queues/queues.module.js';
import { TicketEvent } from '../tickets/ticket-event.entity.js';
import { Ticket } from '../tickets/ticket.entity.js';
import { UsersModule } from '../users/users.module.js';
import { BoardController } from './board.controller.js';
import { BoardService } from './board.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Ticket, TicketEvent]), QueuesModule, UsersModule],
  controllers: [BoardController],
  providers: [BoardService],
})
export class BoardModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ticket } from '../tickets/ticket.entity.js';
import { UsersModule } from '../users/users.module.js';
import { TracesController } from './traces.controller.js';
import { TracesService } from './traces.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Ticket]), UsersModule],
  controllers: [TracesController],
  providers: [TracesService],
})
export class TracesModule {}

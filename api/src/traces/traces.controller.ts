import { Controller, ForbiddenException, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { DemoAuthGuard } from '../auth/demo-auth.guard.js';
import type { User } from '../users/user.entity.js';
import type { TicketTraceView } from './ticket-trace.js';
import { TracesService } from './traces.service.js';

@Controller('tickets')
@UseGuards(DemoAuthGuard)
export class TracesController {
  constructor(private readonly traces: TracesService) {}

  @Get(':id/trace')
  trace(@CurrentUser() user: User, @Param('id', ParseIntPipe) id: number): Promise<TicketTraceView> {
    if (user.role !== 'agency') {
      throw new ForbiddenException('Only the agency can see how the agents worked.');
    }
    return this.traces.forTicket(id);
  }
}

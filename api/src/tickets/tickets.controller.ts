import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { DemoAuthGuard } from '../auth/demo-auth.guard.js';
import type { User } from '../users/user.entity.js';
import { ChangeStatusDto } from './dto/change-status.dto.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';
import { ListTicketsQuery } from './dto/list-tickets.query.js';
import { TicketsService } from './tickets.service.js';
import type { TicketDetailView, TicketView } from './ticket.views.js';

@Controller('tickets')
@UseGuards(DemoAuthGuard)
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateTicketDto): Promise<TicketView> {
    return this.ticketsService.create(user, dto);
  }

  @Get()
  list(@CurrentUser() user: User, @Query() query: ListTicketsQuery): Promise<TicketView[]> {
    return this.ticketsService.list(user, query.status);
  }

  @Get(':id')
  get(@CurrentUser() user: User, @Param('id', ParseIntPipe) id: number): Promise<TicketDetailView> {
    return this.ticketsService.get(user, id);
  }

  @Patch(':id/status')
  async changeStatus(
    @CurrentUser() user: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeStatusDto,
  ): Promise<TicketDetailView> {
    await this.ticketsService.changeStatus(id, dto.status, { type: 'user', user }, dto.message);
    return this.ticketsService.get(user, id);
  }
}

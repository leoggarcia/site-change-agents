import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { DemoAuthGuard } from '../auth/demo-auth.guard.js';
import type { User } from '../users/user.entity.js';
import { AnswerQuestionDto } from './dto/answer-question.dto.js';
import { ChangeStatusDto } from './dto/change-status.dto.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';
import { ListTicketsQuery } from './dto/list-tickets.query.js';
import { IntakeService } from './intake.service.js';
import { TicketsService } from './tickets.service.js';
import type { TicketDetailView, TicketView } from './ticket.views.js';

@Controller('tickets')
@UseGuards(DemoAuthGuard)
export class TicketsController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly intakeService: IntakeService,
  ) {}

  @Post()
  async create(@CurrentUser() user: User, @Body() dto: CreateTicketDto): Promise<TicketView> {
    const ticket = await this.ticketsService.create(user, dto);
    // Answers right away; the Intake Agent works in the background and the panel polls the ticket.
    this.intakeService.start(ticket);
    return ticket;
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
    const ticket = await this.ticketsService.get(user, id);
    // Sending a ticket back to "intake" (from "needs_human") runs the Intake Agent again from the start.
    if (dto.status === 'intake') this.intakeService.start(ticket);
    return ticket;
  }

  @Post(':id/answer')
  async answer(
    @CurrentUser() user: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AnswerQuestionDto,
  ): Promise<TicketDetailView> {
    await this.intakeService.answer(user, id, dto.answer);
    return this.ticketsService.get(user, id);
  }
}

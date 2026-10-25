import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { DemoAuthGuard } from '../auth/demo-auth.guard.js';
import type { User } from '../users/user.entity.js';
import { AnswerQuestionDto } from './dto/answer-question.dto.js';
import { ChangeStatusDto } from './dto/change-status.dto.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';
import { ListTicketsQuery } from './dto/list-tickets.query.js';
import { RequestChangesDto } from './dto/request-changes.dto.js';
import { PipelineService } from './pipeline.service.js';
import { TicketsService } from './tickets.service.js';
import type { TicketDetailView, TicketView } from './ticket.views.js';

@Controller('tickets')
@UseGuards(DemoAuthGuard)
export class TicketsController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly pipeline: PipelineService,
  ) {}

  @Post()
  async create(@CurrentUser() user: User, @Body() dto: CreateTicketDto): Promise<TicketView> {
    const ticket = await this.ticketsService.create(user, dto);
    // Answers right away; an intake job runs the agent and the panel polls the ticket.
    await this.pipeline.startIntake(ticket);
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
    // e.g. back to "intake" runs the Intake Agent again; "pending" queues the ticket for coding.
    await this.pipeline.afterManualChange(await this.ticketsService.findById(id));
    return this.ticketsService.get(user, id);
  }

  /** The client (or the agency) approves the preview; the change is then published. */
  @Post(':id/approve')
  async approve(@CurrentUser() user: User, @Param('id', ParseIntPipe) id: number): Promise<TicketDetailView> {
    await this.pipeline.approve(user, id);
    return this.ticketsService.get(user, id);
  }

  /** The client (or the agency) asks for changes after seeing the preview. */
  @Post(':id/request-changes')
  async requestChanges(
    @CurrentUser() user: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RequestChangesDto,
  ): Promise<TicketDetailView> {
    await this.pipeline.requestChanges(user, id, dto.comment);
    return this.ticketsService.get(user, id);
  }

  @Post(':id/answer')
  async answer(
    @CurrentUser() user: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AnswerQuestionDto,
  ): Promise<TicketDetailView> {
    await this.pipeline.answer(user, id, dto.answer);
    return this.ticketsService.get(user, id);
  }
}

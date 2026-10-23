import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { TICKET_STATUSES } from '../ticket-status.js';
import type { TicketStatus } from '../ticket-status.js';

export class ChangeStatusDto {
  @IsIn(TICKET_STATUSES)
  status: TicketStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}

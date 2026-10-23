import { IsIn, IsOptional } from 'class-validator';
import { TICKET_STATUSES } from '../ticket-status.js';
import type { TicketStatus } from '../ticket-status.js';

export class ListTicketsQuery {
  @IsOptional()
  @IsIn(TICKET_STATUSES)
  status?: TicketStatus;
}

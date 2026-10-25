import { Controller, ForbiddenException, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { DemoAuthGuard } from '../auth/demo-auth.guard.js';
import type { User } from '../users/user.entity.js';
import { BoardService } from './board.service.js';
import type { BoardView } from './board.service.js';

@Controller('board')
@UseGuards(DemoAuthGuard)
export class BoardController {
  constructor(private readonly board: BoardService) {}

  @Get()
  view(@CurrentUser() user: User): Promise<BoardView> {
    if (user.role !== 'agency') {
      throw new ForbiddenException('Only the agency can see the board.');
    }
    return this.board.view();
  }
}

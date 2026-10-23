import { Controller, Get, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { DemoAuthGuard } from '../auth/demo-auth.guard.js';
import { User } from './user.entity.js';

export interface UserView {
  id: string;
  name: string;
  email: string;
  role: User['role'];
  clientName: string | null;
}

function toUserView(user: User): UserView {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    clientName: user.client?.name ?? null,
  };
}

@Controller()
export class UsersController {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  /** DEV ONLY: lists the users that can be picked on the demo sign-in screen. */
  @Get('demo-users')
  async listDemoUsers(): Promise<UserView[]> {
    const users = await this.users.find({ relations: { client: true }, order: { role: 'ASC', name: 'ASC' } });
    return users.map(toUserView);
  }

  @Get('me')
  @UseGuards(DemoAuthGuard)
  async me(@CurrentUser() user: User): Promise<UserView> {
    const withClient = await this.users.findOneOrFail({ where: { id: user.id }, relations: { client: true } });
    return toUserView(withClient);
  }
}

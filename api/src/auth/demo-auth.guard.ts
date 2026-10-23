import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity.js';

export const DEMO_USER_HEADER = 'x-demo-user-id';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuthenticatedRequest extends Request {
  user: User;
}

/**
 * DEV ONLY: trusts the user id sent in the X-Demo-User-Id header, chosen on the panel's demo sign-in screen.
 * Replace with real authentication before exposing the panel to real clients.
 */
@Injectable()
export class DemoAuthGuard implements CanActivate {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.header(DEMO_USER_HEADER);
    if (!userId || !UUID.test(userId)) {
      throw new UnauthorizedException('Sign in first.');
    }

    const user = await this.users.findOneBy({ id: userId });
    if (!user) {
      throw new UnauthorizedException('Unknown user.');
    }
    request.user = user;
    return true;
  }
}

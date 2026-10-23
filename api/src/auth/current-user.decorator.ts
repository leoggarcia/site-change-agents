import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '../users/user.entity.js';
import type { AuthenticatedRequest } from './demo-auth.guard.js';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User => context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);

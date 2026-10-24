import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { QUEUES, redisConnection } from './queues.js';

/** Bull Board shows job data, so it is only on when a password is set (user "agency"). */
function bullBoard(): DynamicModule[] {
  const password = process.env.BULL_BOARD_PASSWORD;
  if (!password) return [];

  const expected = `Basic ${Buffer.from(`agency:${password}`).toString('base64')}`;
  const basicAuth = (req: Request, res: Response, next: NextFunction) => {
    if (req.headers.authorization === expected) return next();
    res.setHeader('WWW-Authenticate', 'Basic realm="Queues"').status(401).send('Sign in to see the queues.');
  };

  return [
    BullBoardModule.forRoot({ route: '/queues', adapter: ExpressAdapter, middleware: basicAuth }),
    ...QUEUES.map(({ name }) => BullBoardModule.forFeature({ name: name!, adapter: BullMQAdapter })),
  ];
}

@Module({
  imports: [
    // Async so REDIS_URL is read at startup (tests point it to their own Redis database).
    BullModule.forRootAsync({ useFactory: () => ({ connection: redisConnection() }) }),
    BullModule.registerQueue(...QUEUES),
    ...bullBoard(),
  ],
  exports: [BullModule],
})
export class QueuesModule {}

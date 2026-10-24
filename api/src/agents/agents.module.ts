import { Module } from '@nestjs/common';
import { AgentsClient } from './agents.client.js';

@Module({
  providers: [AgentsClient],
  exports: [AgentsClient],
})
export class AgentsModule {}

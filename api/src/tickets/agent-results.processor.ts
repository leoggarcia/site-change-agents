import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { AgentReport } from '../agents/agent-results.js';
import { AGENT_RESULTS_QUEUE } from '../queues/queues.js';
import { PipelineService } from './pipeline.service.js';

/**
 * Applies what the Python workers report. Reports come through a queue, not HTTP, so none is lost
 * while the API is down: they wait in Redis until this worker is back.
 */
@Processor(AGENT_RESULTS_QUEUE)
export class AgentResultsProcessor extends WorkerHost {
  constructor(private readonly pipeline: PipelineService) {
    super();
  }

  async process(job: Job<AgentReport>): Promise<void> {
    await this.pipeline.handleReport(job.data);
  }
}

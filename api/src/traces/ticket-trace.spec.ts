import { describe, expect, it } from 'vitest';
import type { Observation } from './langfuse.js';
import { buildTicketTrace } from './ticket-trace.js';

let next = 0;
function observation(
  type: string,
  name: string,
  parent: Observation | null,
  start: number,
  end: number | null,
  extra: Partial<Observation> = {},
): Observation {
  next += 1;
  return {
    id: `o${next}`,
    traceId: parent?.traceId ?? `t${next}`,
    projectId: 'project-1',
    parentObservationId: parent?.id ?? null,
    type,
    name,
    startTime: new Date(Date.UTC(2026, 9, 24, 12, 0, start)).toISOString(),
    endTime: end === null ? null : new Date(Date.UTC(2026, 9, 24, 12, 0, end)).toISOString(),
    ...extra,
  };
}

/** A coder run shaped like a real one: setup, plan (one model call), an edit/tools loop, then the build. */
function coderRun(): Observation[] {
  const agent = observation('AGENT', 'coder', null, 0, 20);
  const graph = observation('CHAIN', 'LangGraph', agent, 4, 20);
  const plan = observation('CHAIN', 'plan', graph, 4, 6);
  const sequence = observation('CHAIN', 'RunnableSequence', plan, 4, 6);
  const planCall = observation('GENERATION', 'ChatGoogleGenerativeAI', sequence, 4, 6, {
    model: 'gemini-3.5-flash-lite',
    usageDetails: { input: 1000, output: 100, total: 1100 },
    totalCost: 0.0006,
  });
  const router = observation('CHAIN', 'after_plan', plan, 6, 6);
  const edit = observation('CHAIN', 'edit', graph, 6, 10);
  const editCall = observation('GENERATION', 'ChatGoogleGenerativeAI', edit, 6, 10, {
    model: 'gemini-3.5-flash-lite',
    usageDetails: { input: 2000, output: 50, total: 2050 },
    totalCost: 0.0007,
  });
  const tools = observation('CHAIN', 'tools', graph, 10, 11);
  const editFile = observation('TOOL', 'edit_file', tools, 10, 11);
  const check = observation('CHAIN', 'check', graph, 11, 20, { level: 'ERROR', statusMessage: 'Build failed' });
  return [agent, graph, plan, sequence, planCall, router, edit, editCall, tools, editFile, check];
}

describe('buildTicketTrace', () => {
  it('keeps the graph nodes, in order, with what happened inside each', () => {
    const view = buildTicketTrace(coderRun(), 'https://langfuse.example', 'ticket-7');

    expect(view.runs).toHaveLength(1);
    const [run] = view.runs;
    expect(run.agent).toBe('coder');
    expect(run.setupMs).toBe(4000);
    expect(run.steps.map((step) => [step.node, step.kind])).toEqual([
      ['plan', 'model'],
      ['edit', 'model'],
      ['tools', 'tools'],
      ['check', 'code'],
    ]);
    expect(run.steps[2].tools).toEqual(['edit_file']);
    expect(run.steps[3].error).toBe('Build failed');
    expect(run.error).toBe('Build failed');
    expect(run).toMatchObject({ modelCalls: 2, toolCalls: 1, inputTokens: 3000, outputTokens: 150, models: ['gemini-3.5-flash-lite'] });
    expect(run.cost).toBeCloseTo(0.0013);
    expect(run.url).toBe(`https://langfuse.example/project/project-1/traces/${run.traceId}`);
    expect(view.sessionUrl).toBe('https://langfuse.example/project/project-1/sessions/ticket-7');
  });

  it('shows a run that is still going, measured up to now', () => {
    const agent = observation('AGENT', 'intake', null, 0, null);
    const graph = observation('CHAIN', 'LangGraph', agent, 0, null);
    const retrieve = observation('CHAIN', 'retrieve', graph, 0, 1);
    const now = new Date(Date.UTC(2026, 9, 24, 12, 0, 30));

    const [run] = buildTicketTrace([agent, graph, retrieve], 'https://langfuse.example', 'ticket-8', now).runs;

    expect(run.running).toBe(true);
    expect(run.durationMs).toBe(30_000);
    expect(run.steps.map((step) => step.node)).toEqual(['retrieve']);
  });

  it('adds up every run of the ticket', () => {
    const view = buildTicketTrace([...coderRun(), ...coderRun()], 'https://langfuse.example', 'ticket-9');

    expect(view.runs).toHaveLength(2);
    expect(view.totals).toMatchObject({ durationMs: 40_000, modelCalls: 4, toolCalls: 2, inputTokens: 6000 });
  });
});

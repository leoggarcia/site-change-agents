import type { Observation } from './langfuse.js';

/**
 * Turns a ticket's Langfuse observations into "how the agents worked": one run per agent trace, and in
 * each run the LangGraph nodes it went through, with the model calls, tools, tokens and cost inside each.
 *
 * What Langfuse stores for one agent run (see agents/src/change_agents/tracing.py):
 *
 *   AGENT "coder"                     <- our span around the whole run
 *     CHAIN "LangGraph"               <- the graph, from the LangChain callback
 *       CHAIN "plan"                  <- one per node the graph ran, in order
 *         GENERATION ...              <- a model call: tokens, cost, model
 *       CHAIN "tools"
 *         TOOL "edit_file"            <- a tool call
 *
 * Everything between a node and its model calls (RunnableSequence, parsers, "after_*" routers) is
 * LangChain plumbing, so we only keep the nodes and add up what happened inside each.
 */

export type StepKind = 'model' | 'tools' | 'code';

export interface TraceStep {
  /** The LangGraph node, e.g. "plan". */
  node: string;
  kind: StepKind;
  /** Offset from the start of the run. */
  startMs: number;
  durationMs: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  tools: string[];
  error: string | null;
}

export interface TraceRun {
  agent: string;
  traceId: string;
  startTime: string;
  durationMs: number;
  /** Still running (no end time yet). */
  running: boolean;
  /** Time spent before the graph started: cloning the site, installing packages... */
  setupMs: number;
  models: string[];
  modelCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  error: string | null;
  steps: TraceStep[];
  url: string;
}

export interface TraceTotals {
  durationMs: number;
  modelCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface TicketTraceView {
  available: boolean;
  /** Why there is nothing to show: tracing is off, or Langfuse did not answer. */
  reason: 'not_configured' | 'unreachable' | null;
  runs: TraceRun[];
  totals: TraceTotals;
  sessionUrl: string | null;
}

const AGENTS = new Set(['intake', 'coder', 'reviewer', 'indexer']);

export function buildTicketTrace(observations: Observation[], baseUrl: string, sessionId: string, now = new Date()): TicketTraceView {
  const children = new Map<string, Observation[]>();
  for (const observation of observations) {
    if (!observation.parentObservationId) continue;
    const siblings = children.get(observation.parentObservationId) ?? [];
    siblings.push(observation);
    children.set(observation.parentObservationId, siblings);
  }
  const kids = (observation: Observation) =>
    (children.get(observation.id) ?? []).sort((a, b) => a.startTime.localeCompare(b.startTime));
  const descendants = (observation: Observation): Observation[] => kids(observation).flatMap((kid) => [kid, ...descendants(kid)]);

  const end = (observation: Observation) => new Date(observation.endTime ?? now).getTime();
  const start = (observation: Observation) => new Date(observation.startTime).getTime();

  const roots = observations.filter((observation) => observation.type === 'AGENT' && AGENTS.has(observation.name));
  const runs = roots.map((root): TraceRun => {
    const runStart = start(root);
    const nodes = kids(root)
      .filter((kid) => kid.name === 'LangGraph')
      .flatMap(kids)
      .filter((node) => !node.name.startsWith('after_'));

    const steps = nodes.map((node): TraceStep => {
      const inside = descendants(node);
      const calls = inside.filter((observation) => observation.type === 'GENERATION');
      const tools = inside.filter((observation) => observation.type === 'TOOL').map((tool) => tool.name);
      const failed = [node, ...inside].find((observation) => observation.level === 'ERROR');
      return {
        node: node.name,
        kind: calls.length > 0 ? 'model' : tools.length > 0 ? 'tools' : 'code',
        startMs: start(node) - runStart,
        durationMs: end(node) - start(node),
        modelCalls: calls.length,
        inputTokens: sum(calls.map((call) => call.usageDetails?.input ?? 0)),
        outputTokens: sum(calls.map((call) => call.usageDetails?.output ?? 0)),
        cost: sum(calls.map((call) => call.totalCost ?? 0)),
        tools,
        error: failed ? failed.statusMessage || 'Failed' : null,
      };
    });

    const calls = descendants(root).filter((observation) => observation.type === 'GENERATION');
    return {
      agent: root.name,
      traceId: root.traceId,
      startTime: root.startTime,
      durationMs: end(root) - runStart,
      running: root.endTime === null,
      setupMs: steps.length > 0 ? steps[0].startMs : 0,
      models: [...new Set(calls.map((call) => call.model).filter((model): model is string => Boolean(model)))],
      modelCalls: calls.length,
      toolCalls: sum(steps.map((step) => step.tools.length)),
      inputTokens: sum(steps.map((step) => step.inputTokens)),
      outputTokens: sum(steps.map((step) => step.outputTokens)),
      cost: sum(calls.map((call) => call.totalCost ?? 0)),
      error: root.level === 'ERROR' ? root.statusMessage || 'Failed' : (steps.find((step) => step.error)?.error ?? null),
      steps,
      url: `${baseUrl}/project/${root.projectId}/traces/${root.traceId}`,
    };
  });

  const projectId = roots[0]?.projectId;
  return {
    available: true,
    reason: null,
    runs,
    totals: {
      durationMs: sum(runs.map((run) => run.durationMs)),
      modelCalls: sum(runs.map((run) => run.modelCalls)),
      toolCalls: sum(runs.map((run) => run.toolCalls)),
      inputTokens: sum(runs.map((run) => run.inputTokens)),
      outputTokens: sum(runs.map((run) => run.outputTokens)),
      cost: sum(runs.map((run) => run.cost)),
    },
    sessionUrl: projectId ? `${baseUrl}/project/${projectId}/sessions/${encodeURIComponent(sessionId)}` : null,
  };
}

export function emptyTrace(reason: TicketTraceView['reason']): TicketTraceView {
  return {
    available: false,
    reason,
    runs: [],
    totals: { durationMs: 0, modelCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
    sessionUrl: null,
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

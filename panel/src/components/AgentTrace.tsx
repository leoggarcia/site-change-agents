import { useEffect, useState } from 'react'
import { api } from '../api'
import type { TicketTrace, TraceRun, TraceStep } from '../types'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import { EmptyState, Skeleton } from './States'

/** How often to read the trace again while an agent is still working. */
const LIVE_POLL_MS = 5000

const AGENTS: Record<string, { name: string; icon: IconName }> = {
  intake: { name: 'Intake', icon: 'intake' },
  coder: { name: 'Coder', icon: 'coder' },
  reviewer: { name: 'Reviewer', icon: 'reviewer' },
  indexer: { name: 'Indexer', icon: 'source' },
}

/** What each LangGraph node does, in plain words (the node names are the ones in each agent's graph.py). */
const NODE_LABELS: Record<string, string> = {
  retrieve: "Search the site's knowledge",
  decide: 'Decide what to do',
  ask_client: 'Ask the client',
  create_ticket: 'Write the ticket',
  out_of_scope: 'Mark as out of scope',
  hand_off: 'Hand off to a person',
  locate: 'Find the files',
  plan: 'Plan the change',
  check: 'Build the site',
  commit: 'Commit the change',
  checks: 'Automatic checks',
  review: 'Model review',
  verdict: 'Give the verdict',
  summarize: 'Write the summary',
}

/** Nodes where the model picks a tool; with the "tools" node after them they form the agent's tool loop. */
const LOOP_NODES = new Set(['edit', 'explore'])

const KIND_ICON: Record<TraceStep['kind'], IconName> = { model: 'spark', tools: 'tool', code: 'terminal' }

type Segment = { type: 'step'; step: TraceStep } | { type: 'loop'; turns: { think: TraceStep; act: TraceStep | null }[] }

export function AgentTrace({ ticketId, live, refreshKey }: { ticketId: number; live: boolean; refreshKey: string }) {
  const [trace, setTrace] = useState<TicketTrace | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.ticketTrace(ticketId).then(
      (next) => {
        if (!cancelled) {
          setTrace(next)
          setError(null)
        }
      },
      (err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the trace.')
      },
    )
    return () => {
      cancelled = true
    }
  }, [ticketId, refreshKey])

  // While an agent works, its run grows step by step, so keep reading it.
  const running = live || Boolean(trace?.runs.some((run) => run.running))
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => {
      api.ticketTrace(ticketId).then(setTrace, () => {})
    }, LIVE_POLL_MS)
    return () => clearInterval(timer)
  }, [running, ticketId])

  return (
    <section className="card trace-card" aria-labelledby="trace-title">
      <header className="trace-head">
        <div>
          <h2 id="trace-title">How the agents worked</h2>
          <p className="muted small">Every step, model call and tool the agents used on this request, read from the Langfuse trace.</p>
        </div>
        {trace?.sessionUrl && (
          <a href={trace.sessionUrl} target="_blank" rel="noreferrer" className="button">
            Open in Langfuse ↗
          </a>
        )}
      </header>

      {error && <p className="error">{error}</p>}
      {!trace && !error && <Skeleton rows={3} label="Loading the trace" />}
      {trace && !trace.available && (
        <EmptyState icon="spark" title={trace.reason === 'not_configured' ? 'Tracing is off' : 'Langfuse did not answer'}>
          {trace.reason === 'not_configured'
            ? 'Add the Langfuse keys to the .env file to see each step the agents take.'
            : 'The trace could not be read right now. It will load again on the next update.'}
        </EmptyState>
      )}
      {trace?.available && trace.runs.length === 0 && (
        <EmptyState icon="spark" title="No traced runs yet">
          Requests handled before tracing was turned on have none. New runs show up a few seconds after an agent starts.
        </EmptyState>
      )}

      {trace?.available && trace.runs.length > 0 && (
        <>
          <dl className="trace-totals">
            <Total label="Agent time" value={seconds(trace.totals.durationMs)} />
            <Total label="Model calls" value={String(trace.totals.modelCalls)} />
            <Total label="Tool calls" value={String(trace.totals.toolCalls)} />
            <Total
              label="Tokens"
              value={compact.format(trace.totals.inputTokens + trace.totals.outputTokens)}
              note={`${compact.format(trace.totals.inputTokens)} in · ${compact.format(trace.totals.outputTokens)} out`}
            />
            <Total label="Cost" value={usd(trace.totals.cost)} />
          </dl>

          <ol className="trace-runs">
            {trace.runs.map((run, index) => (
              <Run key={run.traceId} run={run} nth={trace.runs.slice(0, index).filter((other) => other.agent === run.agent).length} />
            ))}
          </ol>

          <p className="trace-legend muted small">
            <span>
              <i className="swatch kind-model" /> Model call
            </span>
            <span>
              <i className="swatch kind-tools" /> Tools
            </span>
            <span>
              <i className="swatch kind-code" /> Plain code
            </span>
            <span>
              <i className="swatch kind-setup" /> Setup outside the graph
            </span>
          </p>
        </>
      )}
    </section>
  )
}

function Total({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {value}
        {note && <span className="trace-total-note">{note}</span>}
      </dd>
    </div>
  )
}

function Run({ run, nth }: { run: TraceRun; nth: number }) {
  const agent = AGENTS[run.agent] ?? { name: run.agent, icon: 'spark' as IconName }
  const tokens = run.inputTokens + run.outputTokens
  return (
    <li className={run.error ? 'trace-run failed' : 'trace-run'}>
      <div className="trace-run-head">
        <span className={`avatar avatar-sm avatar-${run.agent}`}>
          <Icon name={agent.icon} size={14} />
        </span>
        <div>
          <strong>
            {agent.name} <span className="muted">· {runTitle(run.agent, nth)}</span>
          </strong>
          <span className="trace-run-meta">
            {time.format(new Date(run.startTime))} · {seconds(run.durationMs)}
            {run.running && ' so far'}
            {tokens > 0 && ` · ${compact.format(tokens)} tokens`}
            {run.cost > 0 && ` · ${usd(run.cost)}`}
            {run.models.length > 0 && ` · ${run.models.join(', ')}`}
          </span>
        </div>
        {run.running && (
          <span className="board-tag tone-progress">
            <span className="pulse" aria-hidden="true" />
            Running
          </span>
        )}
        <a href={run.url} target="_blank" rel="noreferrer" className="trace-run-link">
          Trace ↗
        </a>
      </div>

      <ol className="trace-flow" aria-label={`Steps of the ${agent.name} run`}>
        {run.setupMs >= 500 && (
          <li className="trace-node kind-setup">
            <span className="trace-node-label">
              <Icon name="clock" size={13} /> {run.agent === 'coder' ? 'Prepare the workspace' : 'Get ready'}
            </span>
            <span className="trace-node-meta">{seconds(run.setupMs)} · before the graph</span>
          </li>
        )}
        {segments(run.steps).map((segment, index) =>
          segment.type === 'loop' ? <Loop key={index} turns={segment.turns} /> : <Node key={index} step={segment.step} />,
        )}
        {run.steps.length === 0 && !run.running && <li className="trace-node kind-code">No graph steps were recorded.</li>}
      </ol>

      <Timeline run={run} />
      {run.error && <p className="trace-error">{run.error}</p>}
    </li>
  )
}

function Node({ step }: { step: TraceStep }) {
  return (
    <li className={`trace-node kind-${step.kind}${step.error ? ' failed' : ''}`}>
      <span className="trace-node-label">
        <Icon name={KIND_ICON[step.kind]} size={13} /> {NODE_LABELS[step.node] ?? step.node}
      </span>
      <code className="trace-node-name">{step.node}</code>
      <span className="trace-node-meta">
        {seconds(step.durationMs)}
        {step.modelCalls > 0 && ` · ${compact.format(step.inputTokens + step.outputTokens)} tokens`}
      </span>
      {step.tools.length > 0 && (
        <span className="trace-tools">
          {step.tools.map((tool, index) => (
            <code key={index}>{tool}</code>
          ))}
        </span>
      )}
    </li>
  )
}

/** The model → tools → model cycle (ReAct), drawn as one box with a row per turn. */
function Loop({ turns }: { turns: { think: TraceStep; act: TraceStep | null }[] }) {
  return (
    <li className="trace-node trace-loop">
      <span className="trace-node-label">
        <Icon name="retry" size={13} /> Tool loop · {turns.length} {turns.length === 1 ? 'turn' : 'turns'}
      </span>
      <ol className="trace-turns">
        {turns.map(({ think, act }, index) => {
          const tokens = think.inputTokens + think.outputTokens
          return (
            <li key={index} className={think.error || act?.error ? 'failed' : undefined}>
              <span className="trace-turn-number">{index + 1}</span>
              <span>
                {act && act.tools.length > 0 ? (
                  act.tools.map((tool, toolIndex) => <code key={toolIndex}>{tool}</code>)
                ) : (
                  <span className="muted">done, no more tools</span>
                )}
              </span>
              <span className="trace-node-meta">
                {seconds(think.durationMs + (act?.durationMs ?? 0))}
                {tokens > 0 && ` · ${compact.format(tokens)}`}
              </span>
            </li>
          )
        })}
      </ol>
    </li>
  )
}

/** When each step ran, on one bar as long as the whole run. */
function Timeline({ run }: { run: TraceRun }) {
  const total = Math.max(run.durationMs, 1)
  const place = (start: number, length: number) => ({ left: `${(start / total) * 100}%`, width: `${(length / total) * 100}%` })
  return (
    <div className="trace-timeline" aria-hidden="true">
      {run.setupMs > 0 && <span className="trace-bar kind-setup" style={place(0, run.setupMs)} title={`Setup · ${seconds(run.setupMs)}`} />}
      {run.steps.map((step, index) => (
        <span
          key={index}
          className={`trace-bar kind-${step.kind}${step.error ? ' failed' : ''}`}
          style={place(step.startMs, step.durationMs)}
          title={`${NODE_LABELS[step.node] ?? step.node} · ${seconds(step.durationMs)}`}
        />
      ))}
    </div>
  )
}

function segments(steps: TraceStep[]): Segment[] {
  const result: Segment[] = []
  let index = 0
  while (index < steps.length) {
    if (!LOOP_NODES.has(steps[index].node)) {
      result.push({ type: 'step', step: steps[index] })
      index += 1
      continue
    }
    const turns: { think: TraceStep; act: TraceStep | null }[] = []
    while (index < steps.length && LOOP_NODES.has(steps[index].node)) {
      const act = steps[index + 1]?.node === 'tools' ? steps[index + 1] : null
      turns.push({ think: steps[index], act })
      index += act ? 2 : 1
    }
    result.push({ type: 'loop', turns })
  }
  return result
}

function runTitle(agent: string, nth: number): string {
  switch (agent) {
    case 'intake':
      return nth === 0 ? 'read the request' : "read the client's answer"
    case 'coder':
      return nth === 0 ? 'made the change' : 'revised the change'
    case 'reviewer':
      return nth === 0 ? 'checked the change' : 'checked it again'
    default:
      return 'worked on the site'
  }
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const time = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' })

function seconds(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  const value = ms / 1000
  if (value < 60) return `${value.toFixed(value < 10 ? 1 : 0)} s`
  return `${Math.floor(value / 60)} min ${Math.round(value % 60)} s`
}

function usd(value: number): string {
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`
}

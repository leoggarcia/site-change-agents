import { Link } from 'react-router'
import { api } from '../api'
import { STATUS_INFO } from '../statuses'
import type { TicketStatus } from '../types'
import { useLoad } from '../useLoad'

/** The order a ticket moves through, so the counts read like the pipeline. */
const PIPELINE: TicketStatus[] = [
  'intake',
  'pending',
  'in_progress',
  'in_review',
  'awaiting_approval',
  'deployed',
  'needs_human',
  'failed',
]

function duration(minutes: number | null): string {
  if (minutes === null) return '—'
  if (minutes < 1) return `${Math.round(minutes * 60)} s`
  if (minutes < 60) return `${Math.round(minutes)} min`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} h ${Math.round(minutes % 60)} min`
  return `${(minutes / 60 / 24).toFixed(1)} days`
}

function usd(value: number | null): string {
  if (value === null) return '—'
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  )
}

export function MetricsPage() {
  const { data, error, loading } = useLoad(api.metrics)

  if (loading && !data) return <p className="muted">Loading…</p>
  if (error || !data) return <p className="error">{error ?? 'Could not load the metrics.'}</p>

  const { live, baseline } = data
  const baselineMinutes = baseline.hours * 60
  const speedup = live.medianLeadMinutes ? Math.round(baselineMinutes / live.medianLeadMinutes) : null
  const maxCount = Math.max(1, ...Object.values(data.statusCounts))

  return (
    <section className="metrics">
      <h1>Metrics</h1>
      <p className="muted">How requests move from the client's words to the live website, measured from every ticket's history.</p>

      <div className="card hero-metric">
        <span className="stat-label">From request to live (median of {live.count} changes)</span>
        <span className="hero-value">{duration(live.medianLeadMinutes)}</span>
        <span className="muted">
          vs about {baseline.hours === 24 ? '1 day' : `${baseline.hours} h`} for a typical agency change
          {speedup ? ` · about ${speedup}× faster` : ''}
        </span>
        <span className="stat-note">{baseline.label}. Includes the client's own time to answer and approve.</span>
      </div>

      <div className="stat-row">
        <StatTile label="Live changes" value={String(live.count)} />
        <StatTile
          label="Automated end to end"
          value={live.automatedShare === null ? '—' : `${Math.round(live.automatedShare * 100)}%`}
          note="Only the client's approval was human"
        />
        <StatTile label="Agents working" value={duration(live.avgAgentMinutes)} note="Average per change" />
        <StatTile label="Waiting for the client" value={duration(live.avgClientWaitMinutes)} note="Answers and approval" />
        <StatTile
          label="Cost per change"
          value={usd(live.avgCostUsd)}
          note={
            live.avgTokens
              ? `${compact.format(live.avgTokens.input)} in / ${compact.format(live.avgTokens.output)} out tokens · list price`
              : 'List price'
          }
        />
      </div>

      <div className="metrics-grid">
        <div className="card">
          <h2>Tickets by status</h2>
          <ul className="status-bars">
            {PIPELINE.map((status) => {
              const count = data.statusCounts[status]
              return (
                <li key={status}>
                  <span className="status-name">{STATUS_INFO[status].label}</span>
                  <span className="status-track" aria-hidden="true">
                    <span className="status-fill" style={{ width: `${(count / maxCount) * 100}%` }} />
                  </span>
                  <span className="status-count">{count}</span>
                </li>
              )
            })}
          </ul>
          <p className="muted small">
            Handed to a person: {data.handoffs.outOfScope} outside the plan, {data.handoffs.byAgents} stopped by an agent ·{' '}
            {data.handoffs.failed} failed.
          </p>
        </div>

        <div className="card">
          <h2>Where the time goes</h2>
          <dl className="side-fields">
            <dt>Agents working (intake, coding, review, preview)</dt>
            <dd>{duration(live.avgAgentMinutes)}</dd>
            <dt>Waiting for the client (answers and approval)</dt>
            <dd>{duration(live.avgClientWaitMinutes)}</dd>
            <dt>Publishing (merge and production deploy)</dt>
            <dd>{duration(live.avgPublishMinutes)}</dd>
          </dl>
          <p className="muted small">
            Averages over live changes. Models: intake and coder {data.prices.models.coder}, reviewer{' '}
            {data.prices.models.reviewer}. Costs use {data.prices.source}; on the free tier the real cost is $0.
          </p>
        </div>
      </div>

      <div className="card">
        <h2>Latest live changes</h2>
        {data.recent.length === 0 ? (
          <p className="muted">No change is live yet.</p>
        ) : (
          <div className="table-wrap flat">
            <table>
              <thead>
                <tr>
                  <th>Change</th>
                  <th className="num">Request → live</th>
                  <th className="num">Agents</th>
                  <th className="num">Client</th>
                  <th className="num">Cost</th>
                  <th>Automated</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((ticket) => (
                  <tr key={ticket.id}>
                    <td>
                      <Link to={`/tickets/${ticket.id}`}>#{ticket.id}</Link> {ticket.summary}
                      <span className="muted small block">{ticket.siteName}</span>
                    </td>
                    <td className="num">{duration(ticket.leadMinutes)}</td>
                    <td className="num">{duration(ticket.agentMinutes)}</td>
                    <td className="num">{duration(ticket.clientWaitMinutes)}</td>
                    <td className="num">{usd(ticket.costUsd)}</td>
                    <td>{ticket.automated ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '../api'
import { useAuth } from '../auth'
import { Conversation } from '../components/Conversation'
import { DecisionCard } from '../components/DecisionCard'
import { ProgressSteps } from '../components/ProgressSteps'
import { StatusBadge } from '../components/StatusBadge'
import { formatDate, STATUS_INFO } from '../statuses'
import type { TicketDetail, TicketStatus } from '../types'
import { useLoad } from '../useLoad'

/** How often to check the ticket while an agent is working on it. */
const POLL_MS = 3000

/** Statuses in which an agent is working in the background (queue jobs). */
const AGENT_STATUSES: TicketStatus[] = ['intake', 'in_progress', 'in_review']

const CHANGE_TYPES: Record<string, string> = {
  content_update: 'Content update',
  style_change: 'Style change',
  new_section: 'New section',
  image_change: 'Image change',
  out_of_scope: 'Out of scope',
}

export function TicketPage() {
  const id = Number(useParams().id)
  const { user } = useAuth()
  const isAgency = user?.role === 'agency'
  const { data: ticket, error, loading, setData } = useLoad(() => api.ticket(id), [id])

  // Check again until the agent asks something or finishes.
  const agentWorking =
    ticket !== null && ((!ticket.pendingQuestion && AGENT_STATUSES.includes(ticket.status)) || ticket.publishing)
  useEffect(() => {
    if (!agentWorking) return
    const timer = setTimeout(() => {
      api.ticket(id).then(setData, () => {})
    }, POLL_MS)
    return () => clearTimeout(timer)
  }, [agentWorking, ticket, id, setData])

  const backLink = (
    <p className="back">
      <Link to="/">← All requests</Link>
    </p>
  )

  if (loading && !ticket) return <p className="muted">Loading…</p>
  if (error || !ticket) {
    return (
      <>
        {backLink}
        <p className="error">{error ?? 'Ticket not found.'}</p>
      </>
    )
  }

  return (
    <>
      {backLink}
      <header className="ticket-head">
        <div className="ticket-title">
          <h1>{ticket.summary ?? ticket.request}</h1>
          <StatusBadge status={ticket.status} />
        </div>
        <p className="muted">
          {ticket.siteName} · #{ticket.id} · requested by {ticket.createdBy.name} on {formatDate(ticket.createdAt)}
        </p>
        <ProgressSteps status={ticket.status} events={ticket.events} />
        <p className="status-help muted small">{STATUS_INFO[ticket.status].description}</p>
      </header>

      <div className="ticket-layout">
        <div className="ticket-main">
          <DecisionCard ticket={ticket} onChanged={setData} />
          <Conversation ticket={ticket} isAgency={isAgency} onChanged={setData} />
        </div>

        <aside className="ticket-side">
          <TicketCard ticket={ticket} />
          {ticket.change && <CodeChange change={ticket.change} />}
          {ticket.allowedTransitions.length > 0 && <StatusForm ticket={ticket} onChanged={setData} />}
        </aside>
      </div>
    </>
  )
}

function TicketCard({ ticket }: { ticket: TicketDetail }) {
  if (!ticket.summary) {
    return (
      <section className="card side-card">
        <h2>Ticket</h2>
        <p className="muted small">
          {ticket.changeType === 'out_of_scope'
            ? 'This request is outside the plan, so no ticket was written.'
            : 'The intake assistant turns the request into a ticket once it is clear.'}
        </p>
      </section>
    )
  }

  return (
    <section className="card side-card">
      <h2>Ticket</h2>
      <dl className="side-fields">
        <dt>Type</dt>
        <dd>{ticket.changeType ? (CHANGE_TYPES[ticket.changeType] ?? ticket.changeType) : '—'}</dd>
        <dt>Where</dt>
        <dd>{ticket.target ? `${ticket.target.page} › ${ticket.target.section}` : '—'}</dd>
        <dt>Risk</dt>
        <dd>{ticket.risk ? <span className={`risk risk-${ticket.risk}`}>{ticket.risk}</span> : '—'}</dd>
        <dt>Details</dt>
        <dd>{ticket.details ?? '—'}</dd>
      </dl>
      {ticket.acceptanceCriteria && ticket.acceptanceCriteria.length > 0 && (
        <>
          <h3>Done when</h3>
          <ul className="checklist">
            {ticket.acceptanceCriteria.map((criterion) => (
              <li key={criterion}>{criterion}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function CodeChange({ change }: { change: NonNullable<TicketDetail['change']> }) {
  return (
    <section className="card side-card">
      <h2>Code change</h2>
      <dl className="side-fields">
        <dt>Branch</dt>
        <dd>
          <code>{change.branch}</code>
        </dd>
        <dt>Commit</dt>
        <dd>{change.commitSha ? <code>{change.commitSha.slice(0, 7)}</code> : '—'}</dd>
        <dt>Pull request</dt>
        <dd>
          {change.prUrl ? (
            <a href={change.prUrl} target="_blank" rel="noreferrer">
              #{change.prNumber} on GitHub ↗
            </a>
          ) : (
            '—'
          )}
        </dd>
        <dt>Files</dt>
        <dd>
          <ul className="file-list">
            {change.files.map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
          </ul>
        </dd>
      </dl>
    </section>
  )
}

function StatusForm({ ticket, onChanged }: { ticket: TicketDetail; onChanged: (ticket: TicketDetail) => void }) {
  const [status, setStatus] = useState<TicketStatus>(ticket.allowedTransitions[0])
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const updated = await api.changeStatus(ticket.id, status, message || undefined)
      onChanged(updated)
      setStatus(updated.allowedTransitions[0])
      setMessage('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the status.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card side-card">
      <h2>Agency controls</h2>
      <p className="muted small">
        Agents move tickets on their own. Moving one back to “{STATUS_INFO.intake.label}” runs the intake assistant again.
      </p>
      <form onSubmit={submit} className="form">
        <label>
          Move to
          <select value={status} onChange={(event) => setStatus(event.target.value as TicketStatus)}>
            {ticket.allowedTransitions.map((option) => (
              <option key={option} value={option}>
                {STATUS_INFO[option].label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Note for the client (optional)
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={1000} rows={2} />
        </label>
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Update status'}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  )
}

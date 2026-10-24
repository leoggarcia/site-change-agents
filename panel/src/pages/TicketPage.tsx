import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '../api'
import { useAuth } from '../auth'
import { StatusBadge } from '../components/StatusBadge'
import { formatDate, STATUS_INFO } from '../statuses'
import type { TicketDetail, TicketEvent, TicketStatus } from '../types'
import { useLoad } from '../useLoad'

/** How often to check the ticket while an agent is working on it. */
const POLL_MS = 3000

/** What the client sees while an agent works on each step. */
const WORKING_MESSAGES: Partial<Record<TicketStatus, string>> = {
  intake: 'Our assistant is reading your request. This usually takes less than a minute.',
  in_progress: 'The change is being made.',
  in_review: 'The change is being checked before you see it.',
}

export function TicketPage() {
  const id = Number(useParams().id)
  const { user } = useAuth()
  const { data: ticket, error, loading, setData } = useLoad(() => api.ticket(id), [id])

  // Agents work in the background (queue jobs); check again until one asks something or finishes.
  const workingMessage = ticket && !ticket.pendingQuestion ? WORKING_MESSAGES[ticket.status] : undefined
  const agentWorking = workingMessage !== undefined
  useEffect(() => {
    if (!agentWorking) return
    const timer = setTimeout(() => {
      api.ticket(id).then(setData, () => {})
    }, POLL_MS)
    return () => clearTimeout(timer)
  }, [agentWorking, ticket, id, setData])

  const backLink = (
    <p>
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
      <section className="card">
        <div className="ticket-header">
          <div>
            <h1>{ticket.summary ?? `Request #${ticket.id}`}</h1>
            <p className="muted">
              {ticket.siteName} · #{ticket.id} · requested by {ticket.createdBy.name} on {formatDate(ticket.createdAt)}
            </p>
          </div>
          <StatusBadge status={ticket.status} />
        </div>
        <p className="muted">{STATUS_INFO[ticket.status].description}</p>

        <h2>Request</h2>
        <blockquote className="request">{ticket.request}</blockquote>

        {ticket.summary && <StructuredTicket ticket={ticket} />}
      </section>

      {agentWorking && (
        <section className="card working" aria-live="polite">
          <span className="pulse" aria-hidden="true" />
          {workingMessage}
        </section>
      )}

      {ticket.pendingQuestion && (
        <QuestionCard ticket={ticket} canAnswer={user?.role === 'client'} onAnswered={setData} />
      )}

      {ticket.allowedTransitions.length > 0 && <StatusForm ticket={ticket} onChanged={setData} />}

      <section className="card">
        <h2>History</h2>
        <ol className="timeline">
          {ticket.events.map((event) => (
            <li key={event.id}>
              <EventLine event={event} />
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}

function StructuredTicket({ ticket }: { ticket: TicketDetail }) {
  return (
    <>
      <h2>Ticket</h2>
      <dl className="fields">
        <dt>Type</dt>
        <dd>{ticket.changeType ?? '—'}</dd>
        <dt>Where</dt>
        <dd>{ticket.target ? `${ticket.target.page} › ${ticket.target.section}` : '—'}</dd>
        <dt>Details</dt>
        <dd>{ticket.details ?? '—'}</dd>
        <dt>Risk</dt>
        <dd>{ticket.risk ?? '—'}</dd>
      </dl>
      {ticket.acceptanceCriteria && (
        <>
          <h3>Done when</h3>
          <ul>
            {ticket.acceptanceCriteria.map((criterion) => (
              <li key={criterion}>{criterion}</li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

function QuestionCard({
  ticket,
  canAnswer,
  onAnswered,
}: {
  ticket: TicketDetail
  canAnswer: boolean
  onAnswered: (ticket: TicketDetail) => void
}) {
  const question = ticket.pendingQuestion!
  const [answer, setAnswer] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSending(true)
    setError(null)
    try {
      onAnswered(await api.answer(ticket.id, answer))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your answer.')
      setSending(false)
    }
  }

  return (
    <section className="card question-card" aria-live="polite">
      <p className="muted question-meta">
        Question {question.number} of up to {question.max}
      </p>
      <p className="question">{question.question}</p>
      {canAnswer ? (
        <form onSubmit={submit} className="form">
          <label>
            Your answer
            <textarea
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              rows={3}
              maxLength={1000}
              required
              autoFocus
            />
          </label>
          <div>
            <button type="submit" disabled={sending || !answer.trim()}>
              {sending ? 'Sending…' : 'Send answer'}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </form>
      ) : (
        <p className="muted">Waiting for the client to answer.</p>
      )}
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
    <section className="card">
      <h2>Change status</h2>
      <p className="muted">
        Manual control for the agency. The agents move tickets through these steps on their own; moving a ticket
        back to “Reviewing request” runs the intake assistant again.
      </p>
      <form onSubmit={submit} className="form inline-form">
        <label>
          New status
          <select value={status} onChange={(event) => setStatus(event.target.value as TicketStatus)}>
            {ticket.allowedTransitions.map((option) => (
              <option key={option} value={option}>
                {STATUS_INFO[option].label}
              </option>
            ))}
          </select>
        </label>
        <label className="grow">
          Note (optional)
          <input value={message} onChange={(event) => setMessage(event.target.value)} maxLength={1000} />
        </label>
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Update'}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  )
}

function EventLine({ event }: { event: TicketEvent }) {
  const what =
    event.type === 'created'
      ? 'created the request'
      : event.type === 'agent_question'
        ? 'asked'
        : event.type === 'client_answer'
          ? 'answered'
          : event.type === 'status_changed' && event.toStatus
            ? `moved it to “${STATUS_INFO[event.toStatus].label}”`
            : 'added a note'

  return (
    <>
      <div>
        <strong>{event.actor.name}</strong> {what}
        {event.message && <p className="event-message">{event.message}</p>}
        {event.sources.length > 0 && (
          <ul className="sources">
            {event.sources.map((source) => (
              <li key={source}>Source: {source}</li>
            ))}
          </ul>
        )}
        {event.reasoning && <p className="agent-note">Agent’s note (agency only): {event.reasoning}</p>}
        {event.error && <p className="agent-note">Error (agency only): {event.error}</p>}
      </div>
      <time className="muted nowrap">{formatDate(event.createdAt)}</time>
    </>
  )
}

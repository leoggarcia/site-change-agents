import { useState } from 'react'
import type { FormEvent, KeyboardEvent, ReactNode } from 'react'
import { api } from '../api'
import { STATUS_INFO } from '../statuses'
import type { ReviewDetails, TicketDetail, TicketEvent, TicketStatus } from '../types'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import { StatusBadge } from './StatusBadge'

const AGENTS: Record<string, { name: string; icon: IconName }> = {
  intake: { name: 'Intake assistant', icon: 'intake' },
  coder: { name: 'Coder', icon: 'coder' },
  reviewer: { name: 'Reviewer', icon: 'reviewer' },
}

/** Which agent is working while the ticket is in each status, and what the client sees meanwhile. */
const WORKING: Partial<Record<TicketStatus, { agent: string; text: string }>> = {
  intake: { agent: 'intake', text: 'Reading your request…' },
  in_progress: { agent: 'coder', text: 'Making the change…' },
  in_review: { agent: 'reviewer', text: 'Checking the change…' },
}

type Tone = 'neutral' | 'warning' | 'danger' | 'success'

type Item =
  | { kind: 'day'; id: string; label: string }
  | {
      kind: 'message'
      id: string
      side: 'client' | 'team'
      author: string
      avatar: ReactNode
      label?: string
      text: string
      time: string
      status?: TicketStatus | null
      sources: string[]
      note: string | null
      error: string | null
      review: ReviewDetails | null
    }
  | { kind: 'line'; id: string; icon: IconName; tone: Tone; text: string; time: string; error: string | null }

const timeFormat = new Intl.DateTimeFormat('en-US', { timeStyle: 'short' })
const dayFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' })

function initials(name: string): string {
  return name
    .replace(/^(dr|mr|mrs|ms)\.?\s+/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
}

function Avatar({ event }: { event: TicketEvent }) {
  const agent = event.actor.agent ? AGENTS[event.actor.agent] : undefined
  if (agent) {
    return (
      <span className={`avatar avatar-agent avatar-${event.actor.agent}`}>
        <Icon name={agent.icon} size={16} />
      </span>
    )
  }
  if (event.actor.role === 'agency') {
    return (
      <span className="avatar avatar-agency">
        <Icon name="agency" size={16} />
      </span>
    )
  }
  return <span className="avatar avatar-person">{initials(event.actor.name)}</span>
}

function author(event: TicketEvent): string {
  return (event.actor.agent && AGENTS[event.actor.agent]?.name) || event.actor.name
}

function lineFor(event: TicketEvent): { icon: IconName; tone: Tone } {
  if (event.type === 'note') return { icon: 'retry', tone: 'warning' }
  switch (event.toStatus) {
    case 'failed':
      return { icon: 'alert', tone: 'danger' }
    case 'needs_human':
      return { icon: 'flag', tone: 'warning' }
    case 'awaiting_approval':
    case 'deployed':
      return { icon: 'check', tone: 'success' }
    case 'in_progress':
      return { icon: 'play', tone: 'neutral' }
    default:
      return { icon: 'check', tone: 'neutral' }
  }
}

function toItems(ticket: TicketDetail, isAgency: boolean): Item[] {
  const items: Item[] = []
  let lastDay = ''

  for (const event of ticket.events) {
    const day = dayFormat.format(new Date(event.createdAt))
    if (day !== lastDay) {
      items.push({ kind: 'day', id: `day-${event.id}`, label: day })
      lastDay = day
    }
    const time = timeFormat.format(new Date(event.createdAt))
    const moved = event.toStatus ? `Moved to “${STATUS_INFO[event.toStatus].label}”` : ''
    const message = (side: 'client' | 'team', text: string, extra: Partial<Extract<Item, { kind: 'message' }>> = {}): Item => ({
      kind: 'message',
      id: event.id,
      side,
      author: author(event),
      avatar: <Avatar event={event} />,
      text,
      time,
      sources: event.sources,
      note: event.reasoning,
      error: event.error,
      review: event.review,
      ...extra,
    })

    if (event.type === 'created') {
      // The client's request opens the conversation.
      items.push(message('client', ticket.request))
    } else if (event.type === 'agent_question') {
      items.push(
        message('team', event.message ?? '', { label: event.questionNumber ? `Question ${event.questionNumber}` : undefined }),
      )
    } else if (event.type === 'client_answer') {
      items.push(message('client', event.message ?? ''))
    } else if (event.actor.type === 'agent' || (event.actor.type === 'user' && event.message)) {
      // An agent's update, or an agency member's status change with a note.
      items.push(message(event.actor.role === 'client' ? 'client' : 'team', event.message ?? moved, { status: event.toStatus }))
    } else if (event.type === 'note' && !isAgency) {
      // Retries and other technical notes are for the agency only.
      continue
    } else {
      const text = event.actor.type === 'user' ? `${event.actor.name} moved it to “${STATUS_INFO[event.toStatus!].label}”` : event.message || moved
      items.push({ kind: 'line', id: event.id, ...lineFor(event), text, time, error: event.error })
    }
  }
  return items
}

function Details({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="disclosure">
      <summary>{summary}</summary>
      {children}
    </details>
  )
}

function MessageView({ item }: { item: Extract<Item, { kind: 'message' }> }) {
  return (
    <li className={`msg msg-${item.side}`}>
      {item.avatar}
      <div className="msg-body">
        <div className="msg-meta">
          <strong>{item.author}</strong>
          {item.label && <span className="msg-label">{item.label}</span>}
          <time>{item.time}</time>
        </div>
        <div className="bubble">{item.text}</div>
        {item.status && (
          <div className="msg-status">
            <StatusBadge status={item.status} />
          </div>
        )}
        {item.sources.length > 0 && (
          <ul className="source-chips" aria-label="Sources">
            {item.sources.map((source) => (
              <li key={source}>
                <Icon name="source" size={14} />
                {source}
              </li>
            ))}
          </ul>
        )}
        {item.review && <ReviewSummary review={item.review} />}
        {item.note && (
          <Details summary="Agent’s note · agency only">
            <p>{item.note}</p>
          </Details>
        )}
        {item.error && (
          <Details summary="Technical details · agency only">
            <pre>{item.error}</pre>
          </Details>
        )}
      </div>
    </li>
  )
}

function ReviewSummary({ review }: { review: ReviewDetails }) {
  const blocking = review.checks.filter((check) => check.level === 'blocking')
  const passed = blocking.filter((check) => check.passed).length
  const met = review.criteria.filter((item) => item.met).length
  const parts = [`Checks ${passed}/${blocking.length}`]
  if (review.criteria.length) parts.push(`criteria ${met}/${review.criteria.length}`)
  parts.push(review.issues.length ? `${review.issues.length} issue${review.issues.length > 1 ? 's' : ''}` : 'no issues')

  return (
    <Details summary={`Review: ${parts.join(' · ')} · agency only`}>
      <ul className="review-list">
        {review.checks.map((check) => (
          <li key={check.name} className={check.passed ? 'ok' : check.level === 'blocking' ? 'bad' : 'warn'}>
            <span className="mark" aria-hidden="true">
              {check.passed ? '✓' : check.level === 'blocking' ? '✗' : '!'}
            </span>
            <span>
              {check.name}
              {check.findings.length > 0 && <small>{check.findings.slice(0, 3).join(' · ')}</small>}
            </span>
          </li>
        ))}
      </ul>
      {review.criteria.length > 0 && (
        <ul className="review-list">
          {review.criteria.map((item) => (
            <li key={item.criterion} className={item.met ? 'ok' : 'bad'}>
              <span className="mark" aria-hidden="true">
                {item.met ? '✓' : '✗'}
              </span>
              <span>
                {item.criterion}
                <small>{item.evidence}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
      {review.issues.length > 0 && (
        <ul className="issue-list">
          {review.issues.map((issue, index) => (
            <li key={index}>
              <span className={`severity severity-${issue.severity}`}>{issue.severity}</span>
              <span>
                {issue.file && <code>{issue.file}</code>} {issue.problem}
                <small>Fix: {issue.fix}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Details>
  )
}

function Typing({ status }: { status: TicketStatus }) {
  const working = WORKING[status]!
  const agent = AGENTS[working.agent]
  return (
    <li className="msg msg-team" aria-live="polite">
      <span className={`avatar avatar-agent avatar-${working.agent}`}>
        <Icon name={agent.icon} size={16} />
      </span>
      <div className="msg-body">
        <div className="msg-meta">
          <strong>{agent.name}</strong>
        </div>
        <div className="bubble bubble-typing">
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {working.text}
        </div>
      </div>
    </li>
  )
}

function Composer({ ticket, onAnswered }: { ticket: TicketDetail; onAnswered: (ticket: TicketDetail) => void }) {
  const [answer, setAnswer] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(event?: FormEvent) {
    event?.preventDefault()
    if (!answer.trim() || sending) return
    setSending(true)
    setError(null)
    try {
      onAnswered(await api.answer(ticket.id, answer))
      setAnswer('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your answer.')
    } finally {
      setSending(false)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void send()
  }

  return (
    <form className="composer" onSubmit={send}>
      <label className="sr-only" htmlFor="answer">
        Your answer
      </label>
      <textarea
        id="answer"
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        onKeyDown={onKeyDown}
        rows={2}
        maxLength={1000}
        placeholder="Write your answer…"
        autoFocus
      />
      <button type="submit" disabled={sending || !answer.trim()}>
        <Icon name="send" size={16} />
        {sending ? 'Sending…' : 'Send'}
      </button>
      {error && <p className="error composer-error">{error}</p>}
    </form>
  )
}

export function Conversation({
  ticket,
  isAgency,
  onChanged,
}: {
  ticket: TicketDetail
  isAgency: boolean
  onChanged: (ticket: TicketDetail) => void
}) {
  const items = toItems(ticket, isAgency)
  const working = !ticket.pendingQuestion && WORKING[ticket.status] !== undefined

  return (
    <section className="card conversation" aria-label="Conversation">
      <ol className="messages">
        {items.map((item) =>
          item.kind === 'day' ? (
            <li key={item.id} className="day">
              <span>{item.label}</span>
            </li>
          ) : item.kind === 'line' ? (
            <li key={item.id} className={`line line-${item.tone}`}>
              <div className="line-row">
                <Icon name={item.icon} size={14} />
                <span>{item.text}</span>
                <time>{item.time}</time>
              </div>
              {item.error && (
                <Details summary="Technical details · agency only">
                  <pre>{item.error}</pre>
                </Details>
              )}
            </li>
          ) : (
            <MessageView key={item.id} item={item} />
          ),
        )}
        {working && <Typing status={ticket.status} />}
      </ol>

      {ticket.pendingQuestion &&
        (isAgency ? (
          <p className="composer-note muted small">Waiting for the client to answer question {ticket.pendingQuestion.number}.</p>
        ) : (
          <Composer ticket={ticket} onAnswered={onChanged} />
        ))}
    </section>
  )
}

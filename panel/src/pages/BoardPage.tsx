import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../api'
import { Icon } from '../components/Icon'
import type { IconName } from '../components/Icon'
import { PageHeader, Skeleton } from '../components/States'
import type { AgentActivity, AgentKey, Board, BoardTicket, TicketStatus } from '../types'

const POLL_MS = 3000

const AGENTS: Record<AgentKey, { name: string; role: string; icon: IconName }> = {
  intake: { name: 'Intake', role: 'Understands the request and asks questions', icon: 'intake' },
  coder: { name: 'Coder', role: "Edits the site's code", icon: 'coder' },
  reviewer: { name: 'Reviewer', role: 'Checks the change before the client sees it', icon: 'reviewer' },
  publisher: { name: 'Publisher', role: 'Opens the preview and publishes', icon: 'upload' },
  indexer: { name: 'Indexer', role: 'Keeps what we know about each site up to date', icon: 'source' },
}

/** The pipeline, left to right. Each column says which agent (if any) owns that stage. */
const COLUMNS: { title: string; statuses: TicketStatus[]; agent?: AgentKey; icon?: IconName }[] = [
  { title: 'Understanding', statuses: ['intake'], agent: 'intake' },
  { title: 'Queued', statuses: ['pending'], icon: 'clock' },
  { title: 'Coding', statuses: ['in_progress'], agent: 'coder' },
  { title: 'Reviewing', statuses: ['in_review'], agent: 'reviewer' },
  { title: 'Client approval', statuses: ['awaiting_approval'], icon: 'check' },
  { title: 'Live', statuses: ['deployed'], icon: 'globe' },
  { title: 'Needs a person', statuses: ['needs_human', 'failed'], icon: 'flag' },
]

export function BoardPage() {
  const [board, setBoard] = useState<Board | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Tickets that changed column since the last refresh, so they can flash once in their new place.
  const [moved, setMoved] = useState<Set<number>>(new Set())
  const previous = useRef<Board | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    async function refresh() {
      // No point asking while nobody is looking at the tab.
      if (!document.hidden) {
        try {
          const next = await api.board()
          if (cancelled) return
          const before = previous.current && new Map(previous.current.tickets.map((ticket) => [ticket.id, ticket.status]))
          setMoved(
            new Set(before ? next.tickets.filter((ticket) => before.get(ticket.id) !== ticket.status).map((ticket) => ticket.id) : []),
          )
          previous.current = next
          setBoard(next)
          setError(null)
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the board.')
        }
      }
      if (!cancelled) timer = setTimeout(refresh, POLL_MS)
    }

    void refresh()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  const busy = board?.agents.filter((agent) => agent.working.length > 0).length ?? 0

  return (
    <section className="board-page">
      <PageHeader
        title="Live board"
        subtitle={
          board
            ? busy === 0
              ? 'All agents are idle. New requests show up here the moment a client sends them.'
              : `${busy} of ${board.agents.length} agents working right now.`
            : 'What each agent is doing right now, and where every request is.'
        }
        actions={<LiveIndicator connected={!error} />}
      />

      {error && !board && <p className="error">{error}</p>}
      {!board && !error && (
        <div className="card">
          <Skeleton rows={4} label="Loading the board" />
        </div>
      )}

      {board && (
        <>
          <ul className="agent-strip" aria-label="Agents">
            {board.agents.map((activity) => (
              <AgentCard key={activity.agent} activity={activity} now={board.at} />
            ))}
          </ul>

          <div className="kanban" role="list" aria-label="Pipeline">
            {COLUMNS.map((column) => {
              const tickets = board.tickets.filter((ticket) => column.statuses.includes(ticket.status))
              const icon = column.agent ? AGENTS[column.agent].icon : column.icon
              return (
                <section key={column.title} className="kanban-column" role="listitem" aria-label={column.title}>
                  <header className="kanban-head">
                    {icon && <Icon name={icon} size={14} />}
                    <span>{column.title}</span>
                    <span className="chip-count">{tickets.length}</span>
                  </header>
                  {tickets.length === 0 ? (
                    <p className="kanban-empty">Nothing here</p>
                  ) : (
                    <ul className="kanban-cards">
                      {tickets.map((ticket) => (
                        <TicketCard key={ticket.id} ticket={ticket} now={board.at} moved={moved.has(ticket.id)} />
                      ))}
                    </ul>
                  )}
                </section>
              )
            })}
          </div>
          <p className="muted small">
            Live shows the {board.tickets.filter((ticket) => ticket.status === 'deployed').length} most recent changes. Every request is in{' '}
            <Link to="/">Requests</Link>.
          </p>
        </>
      )}
    </section>
  )
}

function LiveIndicator({ connected }: { connected: boolean }) {
  return (
    <span className={connected ? 'live-pill' : 'live-pill offline'} role="status">
      <span className="live-dot" aria-hidden="true" />
      {connected ? 'Live' : 'Reconnecting…'}
    </span>
  )
}

function AgentCard({ activity, now }: { activity: AgentActivity; now: string }) {
  const agent = AGENTS[activity.agent]
  const working = activity.working.length > 0
  return (
    <li className={working ? `agent-card working agent-${activity.agent}` : `agent-card agent-${activity.agent}`}>
      <div className="agent-card-head">
        <span className={`avatar avatar-${activity.agent}`}>
          <Icon name={agent.icon} size={16} />
        </span>
        <span>
          <strong>{agent.name}</strong>
          <span className="agent-role">{agent.role}</span>
        </span>
      </div>

      {working ? (
        activity.working.map((job, index) => (
          <p key={index} className="agent-now">
            <span className="pulse" aria-hidden="true" />
            <span>
              {job.ticketId ? <Link to={`/tickets/${job.ticketId}`}>{job.label}</Link> : job.label}
              <span className="agent-meta">
                for {elapsed(job.since, now)}
                {job.attempt > 1 && ` · attempt ${job.attempt}`}
              </span>
            </span>
          </p>
        ))
      ) : (
        <p className="agent-now idle">Idle</p>
      )}

      {(activity.waiting > 0 || activity.retrying > 0) && (
        <p className="agent-queue">
          {activity.waiting > 0 && <span>{activity.waiting} waiting</span>}
          {activity.retrying > 0 && (
            <span className="retrying">
              <Icon name="retry" size={12} /> {activity.retrying} retrying
            </span>
          )}
        </p>
      )}
    </li>
  )
}

function TicketCard({ ticket, now, moved }: { ticket: BoardTicket; now: string; moved: boolean }) {
  const classes = ['board-card']
  if (moved) classes.push('moved')
  if (ticket.activeAgent) classes.push('active')
  if (ticket.status === 'failed') classes.push('failed')

  return (
    <li className={classes.join(' ')}>
      <div className="board-card-top">
        <span className="mono">#{ticket.id}</span>
        <span title="Time in this stage">{elapsed(ticket.since, now)}</span>
      </div>
      <Link to={`/tickets/${ticket.id}`} className="board-card-title">
        {ticket.summary}
      </Link>
      <span className="board-card-site">{ticket.siteName}</span>

      {ticket.activeAgent && (
        <span className={`board-tag agent-${ticket.activeAgent}`}>
          <span className="pulse" aria-hidden="true" />
          {AGENTS[ticket.activeAgent].name} is on it
        </span>
      )}
      {!ticket.activeAgent && ticket.publishing && (
        <span className="board-tag tone-progress">
          <span className="pulse" aria-hidden="true" />
          Publishing
        </span>
      )}
      {!ticket.activeAgent && ticket.waitingForClient && <span className="board-tag tone-attention">Waiting for the client</span>}
      {ticket.status === 'failed' && <span className="board-tag tone-danger">Failed</span>}
      {ticket.previewUrl && ticket.status === 'awaiting_approval' && (
        <a href={ticket.previewUrl} target="_blank" rel="noreferrer" className="board-card-link">
          Open preview ↗
        </a>
      )}
    </li>
  )
}

/** "45s", "3m", "2h 5m", "4d" between two ISO timestamps (both from the server, so clocks agree). */
function elapsed(from: string, to: string): string {
  const seconds = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

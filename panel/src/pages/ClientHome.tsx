import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '../api'
import { useAuth } from '../auth'
import { Icon } from '../components/Icon'
import { EmptyState, PageHeader, Skeleton } from '../components/States'
import { StatusBadge } from '../components/StatusBadge'
import { formatDate } from '../statuses'
import { useLoad } from '../useLoad'

export function ClientHome() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const sites = useLoad(api.sites)
  const tickets = useLoad(api.tickets)
  const [siteId, setSiteId] = useState('')
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedSite = siteId || sites.data?.[0]?.id || ''
  const firstName = user?.name.replace(/^(Dr|Mr|Mrs|Ms)\.?\s+/, '').split(' ')[0]

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const ticket = await api.createTicket(selectedSite, text)
      await navigate(`/tickets/${ticket.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your request.')
      setSubmitting(false)
    }
  }

  return (
    <>
      <PageHeader
        title={`Hi ${firstName}, what should we change?`}
        subtitle="Describe it in your own words. If something is missing we'll ask, and you'll see a preview before anything goes live."
      />

      <section className="card composer-card">
        <form onSubmit={submit} className="form">
          <label>
            What do you want to change?
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="For example: our phone number is now 618 765 4321"
              required
            />
          </label>
          <div className="composer-footer">
            {(sites.data?.length ?? 0) > 1 ? (
              <label className="inline-label">
                Website
                <select value={selectedSite} onChange={(event) => setSiteId(event.target.value)} required>
                  {sites.data?.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="muted small">{sites.data?.[0]?.name}</span>
            )}
            <button type="submit" disabled={submitting || !selectedSite || text.trim().length < 5}>
              <Icon name="send" size={15} />
              {submitting ? 'Sending…' : 'Send request'}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </form>
      </section>

      <h2>Your requests</h2>
      <section className="card list-card">
        {tickets.loading && !tickets.data && <Skeleton rows={3} />}
        {tickets.error && <p className="error">{tickets.error}</p>}
        {tickets.data?.length === 0 && (
          <EmptyState icon="inbox" title="No requests yet">
            When you ask for a change, it shows up here with its progress.
          </EmptyState>
        )}
        <ul className="ticket-list">
          {tickets.data?.map((ticket) => (
            <li key={ticket.id}>
              <Link to={`/tickets/${ticket.id}`} className="ticket-row">
                <span>
                  <strong>{ticket.summary ?? ticket.request}</strong>
                  <span className="meta">
                    {ticket.siteName} · <span className="mono">#{ticket.id}</span> · updated {formatDate(ticket.updatedAt)}
                  </span>
                </span>
                <StatusBadge status={ticket.status} />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

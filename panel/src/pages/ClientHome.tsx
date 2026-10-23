import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '../api'
import { StatusBadge } from '../components/StatusBadge'
import { formatDate } from '../statuses'
import { useLoad } from '../useLoad'

export function ClientHome() {
  const navigate = useNavigate()
  const sites = useLoad(api.sites)
  const tickets = useLoad(api.tickets)
  const [siteId, setSiteId] = useState('')
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedSite = siteId || sites.data?.[0]?.id || ''

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
      <section className="card">
        <h1>Request a change</h1>
        <form onSubmit={submit} className="form">
          <label>
            Which website?
            <select value={selectedSite} onChange={(event) => setSiteId(event.target.value)} required>
              {sites.data?.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            What do you want to change?
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="For example: change the phone number in the footer to 618 765 4321"
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={submitting || !selectedSite || text.trim().length < 5}>
            {submitting ? 'Sending…' : 'Send request'}
          </button>
        </form>
      </section>

      <section>
        <h2>Your requests</h2>
        {tickets.loading && <p className="muted">Loading…</p>}
        {tickets.error && <p className="error">{tickets.error}</p>}
        {tickets.data?.length === 0 && <p className="muted">You haven't requested any changes yet.</p>}
        <ul className="ticket-list">
          {tickets.data?.map((ticket) => (
            <li key={ticket.id}>
              <Link to={`/tickets/${ticket.id}`} className="card ticket-card">
                <div>
                  <strong>{ticket.summary ?? ticket.request}</strong>
                  <span className="muted">
                    {ticket.siteName} · #{ticket.id} · updated {formatDate(ticket.updatedAt)}
                  </span>
                </div>
                <StatusBadge status={ticket.status} />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

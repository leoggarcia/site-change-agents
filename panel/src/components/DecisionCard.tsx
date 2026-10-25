import { useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../api'
import type { TicketDetail } from '../types'

/** The step only a person can take: look at the preview, then approve it or ask for changes. */
export function DecisionCard({ ticket, onChanged }: { ticket: TicketDetail; onChanged: (ticket: TicketDetail) => void }) {
  const [asking, setAsking] = useState(false)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<TicketDetail>) {
    setBusy(true)
    setError(null)
    try {
      onChanged(await action())
      setAsking(false)
      setComment('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  function sendChanges(event: FormEvent) {
    event.preventDefault()
    void run(() => api.requestChanges(ticket.id, comment))
  }

  if (ticket.status === 'deployed') {
    return (
      <section className="card decision decision-live">
        <div>
          <h2>Your change is live</h2>
          <p className="muted">It is published on your website.</p>
        </div>
        {ticket.productionUrl && (
          <a className="button" href={ticket.productionUrl} target="_blank" rel="noreferrer">
            View the website ↗
          </a>
        )}
      </section>
    )
  }

  if (ticket.status !== 'awaiting_approval') return null

  if (ticket.publishing) {
    return (
      <section className="card decision" aria-live="polite">
        <div>
          <h2>Publishing your change…</h2>
          <p className="muted">Approved. It goes live in a minute or two.</p>
        </div>
        <span className="dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </section>
    )
  }

  return (
    <section className="card decision decision-ready">
      <div className="decision-row">
        <div>
          <h2>{ticket.previewUrl ? 'Your preview is ready' : 'Ready for your approval'}</h2>
          <p className="muted">
            {ticket.previewUrl
              ? 'This is your website with the change. Nothing is published until you approve it.'
              : 'There is no preview in local mode; approving marks the change as done.'}
          </p>
        </div>
        {ticket.previewUrl && (
          <a className="button secondary-button" href={ticket.previewUrl} target="_blank" rel="noreferrer">
            Open preview ↗
          </a>
        )}
      </div>

      {asking ? (
        <form className="form" onSubmit={sendChanges}>
          <label>
            What should change?
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="e.g. The number should also be in the header."
              autoFocus
            />
          </label>
          <div className="inline-actions">
            <button type="submit" disabled={busy || comment.trim().length < 3}>
              {busy ? 'Sending…' : 'Send to the developer'}
            </button>
            <button type="button" className="link-button" onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="inline-actions">
          <button type="button" className="primary" disabled={busy} onClick={() => void run(() => api.approve(ticket.id))}>
            {busy ? 'Approving…' : 'Approve and publish'}
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => setAsking(true)}>
            Ask for changes
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  )
}

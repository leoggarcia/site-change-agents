import { Link, useSearchParams } from 'react-router'
import { api } from '../api'
import { StatusBadge } from '../components/StatusBadge'
import { formatDate, STATUS_INFO } from '../statuses'
import type { TicketStatus } from '../types'
import { useLoad } from '../useLoad'

const STATUSES = Object.keys(STATUS_INFO) as TicketStatus[]

export function AgencyHome() {
  const [params, setParams] = useSearchParams()
  const filter = params.get('status') as TicketStatus | null
  const { data, error, loading } = useLoad(api.tickets)

  const tickets = data ?? []
  const visible = filter ? tickets.filter((ticket) => ticket.status === filter) : tickets
  const count = (status: TicketStatus) => tickets.filter((ticket) => ticket.status === status).length

  return (
    <section>
      <h1>All requests</h1>
      <div className="filters">
        <button type="button" className={filter ? 'chip' : 'chip active'} onClick={() => setParams({})}>
          All ({tickets.length})
        </button>
        {STATUSES.map((status) => (
          <button
            type="button"
            key={status}
            className={filter === status ? 'chip active' : 'chip'}
            onClick={() => setParams({ status })}
          >
            {STATUS_INFO[status].label} ({count(status)})
          </button>
        ))}
      </div>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}
      {!loading && visible.length === 0 && <p className="muted">No requests here.</p>}

      {visible.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Site</th>
                <th>Request</th>
                <th>Status</th>
                <th>Requested by</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((ticket) => (
                <tr key={ticket.id}>
                  <td>
                    <Link to={`/tickets/${ticket.id}`}>#{ticket.id}</Link>
                  </td>
                  <td>{ticket.siteName}</td>
                  <td className="request-cell">
                    <Link to={`/tickets/${ticket.id}`}>{ticket.summary ?? ticket.request}</Link>
                  </td>
                  <td>
                    <StatusBadge status={ticket.status} />
                  </td>
                  <td>{ticket.createdBy.name}</td>
                  <td className="nowrap">{formatDate(ticket.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

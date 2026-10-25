import { Link, useSearchParams } from 'react-router'
import { api } from '../api'
import { EmptyState, PageHeader, Skeleton } from '../components/States'
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
      <PageHeader title="Requests" subtitle="Every client request, from the first message to the live website." />

      <div className="filters" role="tablist" aria-label="Filter by status">
        <button type="button" role="tab" aria-selected={!filter} className={filter ? 'chip' : 'chip active'} onClick={() => setParams({})}>
          All <span className="chip-count">{tickets.length}</span>
        </button>
        {STATUSES.filter((status) => count(status) > 0 || filter === status).map((status) => (
          <button
            type="button"
            role="tab"
            aria-selected={filter === status}
            key={status}
            className={filter === status ? 'chip active' : 'chip'}
            onClick={() => setParams({ status })}
          >
            {STATUS_INFO[status].label} <span className="chip-count">{count(status)}</span>
          </button>
        ))}
      </div>

      {error && <p className="error">{error}</p>}
      {loading && !data && (
        <div className="card">
          <Skeleton rows={5} />
        </div>
      )}
      {data && visible.length === 0 && (
        <div className="card">
          <EmptyState icon="inbox" title={filter ? `No requests in “${STATUS_INFO[filter].label}”` : 'No requests yet'}>
            Requests appear here as soon as a client writes one.
          </EmptyState>
        </div>
      )}

      {visible.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Request</th>
                <th>Status</th>
                <th>Requested by</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((ticket) => (
                <tr key={ticket.id}>
                  <td className="ticket-id">{ticket.id}</td>
                  <td className="request-cell">
                    <Link to={`/tickets/${ticket.id}`}>{ticket.summary ?? ticket.request}</Link>
                    <span className="muted small block">{ticket.siteName}</span>
                  </td>
                  <td>
                    <StatusBadge status={ticket.status} />
                  </td>
                  <td>{ticket.createdBy.name}</td>
                  <td className="nowrap muted small">{formatDate(ticket.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

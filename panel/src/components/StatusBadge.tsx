import { STATUS_INFO } from '../statuses'
import type { TicketStatus } from '../types'

export function StatusBadge({ status }: { status: TicketStatus }) {
  const info = STATUS_INFO[status]
  return <span className={`badge badge-${info.tone}`}>{info.label}</span>
}

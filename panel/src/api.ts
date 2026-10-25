import type { ProjectSummaryRecord, Site, Ticket, TicketDetail, TicketStatus, User } from './types'

const DEMO_USER_KEY = 'demoUserId'

export function getStoredUserId(): string | null {
  try {
    return localStorage.getItem(DEMO_USER_KEY)
  } catch {
    return null
  }
}

export function storeUserId(id: string | null): void {
  try {
    if (id) localStorage.setItem(DEMO_USER_KEY, id)
    else localStorage.removeItem(DEMO_USER_KEY)
  } catch {
    // Storage can be unavailable (private mode); the session then lasts until reload.
  }
}

let currentUserId: string | null = getStoredUserId()

export function setCurrentUserId(id: string | null): void {
  currentUserId = id
  storeUserId(id)
}

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (currentUserId) headers.set('X-Demo-User-Id', currentUserId)

  const response = await fetch(`/api${path}`, { ...init, headers })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null
    const message = Array.isArray(body?.message) ? body.message.join(' ') : (body?.message ?? response.statusText)
    throw new ApiError(response.status, message)
  }
  return (await response.json()) as T
}

export const api = {
  demoUsers: () => request<User[]>('/demo-users'),
  me: () => request<User>('/me'),
  sites: () => request<Site[]>('/sites'),
  siteSummary: (siteId: string) => request<ProjectSummaryRecord>(`/sites/${siteId}/summary`),
  reindex: (siteId: string) => request<{ queued: true }>(`/sites/${siteId}/reindex`, { method: 'POST' }),
  tickets: () => request<Ticket[]>('/tickets'),
  ticket: (id: number) => request<TicketDetail>(`/tickets/${id}`),
  createTicket: (siteId: string, text: string) =>
    request<Ticket>('/tickets', { method: 'POST', body: JSON.stringify({ siteId, request: text }) }),
  answer: (id: number, answer: string) =>
    request<TicketDetail>(`/tickets/${id}/answer`, { method: 'POST', body: JSON.stringify({ answer }) }),
  approve: (id: number) => request<TicketDetail>(`/tickets/${id}/approve`, { method: 'POST' }),
  requestChanges: (id: number, comment: string) =>
    request<TicketDetail>(`/tickets/${id}/request-changes`, { method: 'POST', body: JSON.stringify({ comment }) }),
  changeStatus: (id: number, status: TicketStatus, message?: string) =>
    request<TicketDetail>(`/tickets/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, message }) }),
}

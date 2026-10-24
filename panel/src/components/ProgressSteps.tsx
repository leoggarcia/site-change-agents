import type { TicketEvent, TicketStatus } from '../types'

/** The happy path every request follows. Failed and "with the agency" are shown on the step where they stopped. */
const STEPS: { status: TicketStatus; label: string }[] = [
  { status: 'intake', label: 'Request' },
  { status: 'pending', label: 'Queued' },
  { status: 'in_progress', label: 'Making the change' },
  { status: 'in_review', label: 'Checking' },
  { status: 'awaiting_approval', label: 'Your approval' },
  { status: 'deployed', label: 'Live' },
]

function stepIndex(status: TicketStatus | null): number {
  return STEPS.findIndex((step) => step.status === status)
}

export function ProgressSteps({ status, events }: { status: TicketStatus; events: TicketEvent[] }) {
  const stopped = status === 'failed' || status === 'needs_human'
  // When it stopped, the step it was on is the last happy-path status it reached.
  const reached = stopped
    ? Math.max(0, ...events.map((event) => stepIndex(event.toStatus)).filter((index) => index >= 0))
    : stepIndex(status)
  const current = STEPS[reached]

  return (
    <div className="progress">
      <ol className="steps" aria-label="Progress">
        {STEPS.map((step, index) => {
          const state =
            index < reached || (index === reached && status === 'deployed')
              ? 'done'
              : index === reached
                ? stopped
                  ? status === 'failed'
                    ? 'failed'
                    : 'paused'
                  : 'current'
                : 'todo'
          return (
            <li key={step.status} className={`step step-${state}`} aria-current={index === reached ? 'step' : undefined}>
              <span className="step-dot" />
              <span className="step-label">{step.label}</span>
            </li>
          )
        })}
      </ol>
      <p className="steps-mobile muted small">
        Step {reached + 1} of {STEPS.length}: {current.label}
        {stopped && (status === 'failed' ? ' · failed' : ' · with the agency')}
      </p>
    </div>
  )
}

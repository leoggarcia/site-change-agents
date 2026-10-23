import { canTransition, TICKET_STATUSES, TICKET_TRANSITIONS } from './ticket-status.js';

describe('ticket status transitions', () => {
  it('only points to known statuses', () => {
    for (const targets of Object.values(TICKET_TRANSITIONS)) {
      for (const target of targets) {
        expect(TICKET_STATUSES).toContain(target);
      }
    }
  });

  it('treats "deployed" as final', () => {
    expect(TICKET_TRANSITIONS.deployed).toEqual([]);
  });

  it('never skips the review and approval steps', () => {
    expect(canTransition('pending', 'deployed')).toBe(false);
    expect(canTransition('in_progress', 'awaiting_approval')).toBe(false);
    expect(canTransition('in_review', 'deployed')).toBe(false);
    expect(canTransition('awaiting_approval', 'deployed')).toBe(true);
  });
});

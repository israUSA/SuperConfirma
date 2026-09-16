/** R-04: how long a chosen time stays reserved while the customer fills the form. */
export const HOLD_MINUTES = 10;

export const BOOKING_STATUSES = [
  'hold',
  'pending',
  'confirmed',
  'unconfirmed',
  'arrived',
  'completed',
  'cancelled',
  'no_show',
  'rescheduled',
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export type BookingEvent =
  | 'submit'
  | 'confirm'
  | 'mark_unconfirmed'
  | 'arrive'
  | 'complete'
  | 'cancel'
  | 'expire'
  | 'mark_no_show'
  | 'reschedule';

// Must stay identical to booking_status_blocks() in SQL; a db test checks parity.
const BLOCKING: ReadonlySet<BookingStatus> = new Set([
  'hold',
  'pending',
  'confirmed',
  'unconfirmed',
  'arrived',
  'completed',
]);

export function isBlocking(status: BookingStatus): boolean {
  return BLOCKING.has(status);
}

const TERMINAL: ReadonlySet<BookingStatus> = new Set(['completed', 'cancelled', 'no_show', 'rescheduled']);

export function isTerminal(status: BookingStatus): boolean {
  return TERMINAL.has(status);
}

const TRANSITIONS: Record<BookingEvent, Partial<Record<BookingStatus, BookingStatus>>> = {
  submit: { hold: 'pending' },
  confirm: { pending: 'confirmed', unconfirmed: 'confirmed' },
  mark_unconfirmed: { pending: 'unconfirmed' },
  arrive: { pending: 'arrived', confirmed: 'arrived', unconfirmed: 'arrived' },
  complete: { arrived: 'completed' },
  cancel: { hold: 'cancelled', pending: 'cancelled', confirmed: 'cancelled', unconfirmed: 'cancelled' },
  expire: { hold: 'cancelled' },
  mark_no_show: { pending: 'no_show', confirmed: 'no_show', unconfirmed: 'no_show' },
  reschedule: { pending: 'rescheduled', confirmed: 'rescheduled', unconfirmed: 'rescheduled' },
};

/** Whether some event moves `from` to `to`. Mirrors booking_transition_allowed() in SQL. */
export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return Object.values(TRANSITIONS).some((map) => map[from] === to);
}

// Repeating an event whose effect already happened (a customer taps "Confirmar" twice,
// a webhook is redelivered) is a no-op, not an error.
const ALREADY_APPLIED: Partial<Record<BookingEvent, BookingStatus>> = {
  confirm: 'confirmed',
  cancel: 'cancelled',
  arrive: 'arrived',
  complete: 'completed',
  mark_no_show: 'no_show',
};

export interface BookingSnapshot {
  status: BookingStatus;
  startsAt: number;
  holdExpiresAt: number | null;
}

export type TransitionResult =
  | { ok: true; status: BookingStatus; changed: boolean }
  | { ok: false; reason: 'invalid_transition' | 'hold_expired' | 'hold_not_expired' | 'not_started' };

export function transition(booking: BookingSnapshot, event: BookingEvent, now: number): TransitionResult {
  if (ALREADY_APPLIED[event] === booking.status) {
    return { ok: true, status: booking.status, changed: false };
  }

  const next = TRANSITIONS[event][booking.status];
  if (!next) return { ok: false, reason: 'invalid_transition' };

  if (booking.status === 'hold') {
    const expired = booking.holdExpiresAt !== null && now >= booking.holdExpiresAt;
    if (event === 'expire' && !expired) return { ok: false, reason: 'hold_not_expired' };
    if (event === 'submit' && expired) return { ok: false, reason: 'hold_expired' };
  }

  if (event === 'mark_no_show' && now < booking.startsAt) {
    return { ok: false, reason: 'not_started' };
  }

  return { ok: true, status: next, changed: true };
}

import { describe, expect, it } from 'vitest';
import { BOOKING_STATUSES, isBlocking, isTerminal, transition, type BookingSnapshot } from '../src/index.ts';

const T0 = Date.UTC(2026, 9, 19, 14, 0);
const MIN = 60_000;

const hold = (expiresInMin = 10): BookingSnapshot => ({ status: 'hold', startsAt: T0 + 60 * MIN, holdExpiresAt: T0 + expiresInMin * MIN });
const booking = (status: BookingSnapshot['status']): BookingSnapshot => ({ status, startsAt: T0 + 60 * MIN, holdExpiresAt: null });

describe('transition', () => {
  it('recorre el camino feliz', () => {
    expect(transition(hold(), 'submit', T0)).toEqual({ ok: true, status: 'pending', changed: true });
    expect(transition(booking('pending'), 'confirm', T0)).toEqual({ ok: true, status: 'confirmed', changed: true });
    expect(transition(booking('confirmed'), 'arrive', T0)).toEqual({ ok: true, status: 'arrived', changed: true });
    expect(transition(booking('arrived'), 'complete', T0)).toEqual({ ok: true, status: 'completed', changed: true });
  });

  it('confirmar dos veces no es error ni cambio (botón repetido, webhook reentregado)', () => {
    expect(transition(booking('confirmed'), 'confirm', T0)).toEqual({ ok: true, status: 'confirmed', changed: false });
    expect(transition(booking('cancelled'), 'cancel', T0)).toEqual({ ok: true, status: 'cancelled', changed: false });
  });

  it('una retención vencida no se puede completar (R-04)', () => {
    expect(transition(hold(10), 'submit', T0 + 10 * MIN)).toEqual({ ok: false, reason: 'hold_expired' });
  });

  it('solo expira una retención vencida', () => {
    expect(transition(hold(10), 'expire', T0 + 9 * MIN)).toEqual({ ok: false, reason: 'hold_not_expired' });
    expect(transition(hold(10), 'expire', T0 + 10 * MIN)).toEqual({ ok: true, status: 'cancelled', changed: true });
    expect(transition(booking('pending'), 'expire', T0)).toEqual({ ok: false, reason: 'invalid_transition' });
  });

  it('no marca inasistencia antes de la hora de la cita', () => {
    expect(transition(booking('confirmed'), 'mark_no_show', T0)).toEqual({ ok: false, reason: 'not_started' });
    expect(transition(booking('confirmed'), 'mark_no_show', T0 + 60 * MIN)).toEqual({ ok: true, status: 'no_show', changed: true });
  });

  it('un cliente sin confirmar todavía puede confirmar', () => {
    expect(transition(booking('pending'), 'mark_unconfirmed', T0)).toMatchObject({ status: 'unconfirmed' });
    expect(transition(booking('unconfirmed'), 'confirm', T0)).toMatchObject({ status: 'confirmed' });
  });

  it('los estados terminales no aceptan cambios', () => {
    for (const status of BOOKING_STATUSES.filter(isTerminal)) {
      for (const event of ['submit', 'confirm', 'arrive', 'reschedule', 'mark_unconfirmed'] as const) {
        const result = transition(booking(status), event, T0);
        if (result.ok) expect(result.changed).toBe(false);
      }
    }
  });

  it('no se puede cancelar una cita ya atendida', () => {
    expect(transition(booking('arrived'), 'cancel', T0)).toEqual({ ok: false, reason: 'invalid_transition' });
  });
});

describe('isBlocking (R-03)', () => {
  it('cancelada, reprogramada e inasistencia liberan el horario', () => {
    expect(BOOKING_STATUSES.filter((s) => !isBlocking(s))).toEqual(['cancelled', 'no_show', 'rescheduled']);
  });
});

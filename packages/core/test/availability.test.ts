import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import {
  generateSlots,
  groupSlotsByStart,
  occupiedSpan,
  type AvailabilityQuery,
  type AvailabilityRule,
  type Weekday,
} from '../src/index.ts';

const QUITO = 'America/Guayaquil';
const DRA = 'dra-paredes';
const LIC = 'lic-andrade';

const at = (iso: string, zone = QUITO) => DateTime.fromISO(iso, { zone }).toMillis();
const local = (ms: number, zone = QUITO) => DateTime.fromMillis(ms, { zone }).toFormat("ccc HH:mm");

const weekdays = (resourceId: string | null, startsLocal: string, endsLocal: string, slotMinutes = 30): AvailabilityRule[] =>
  ([1, 2, 3, 4, 5] as Weekday[]).map((weekday) => ({ resourceId, weekday, startsLocal, endsLocal, slotMinutes }));

function query(overrides: Partial<AvailabilityQuery> = {}): AvailabilityQuery {
  return {
    timezone: QUITO,
    fromDate: '2026-10-19',
    toDate: '2026-10-25',
    now: at('2026-10-18T12:00'),
    service: { durationMin: 30, bufferBeforeMin: 0, bufferAfterMin: 0, resources: [{ resourceId: DRA }] },
    rules: weekdays(null, '09:00', '13:00'),
    exceptions: [],
    busy: [],
    window: { minAdvanceMin: 0, maxAdvanceDays: 60 },
    ...overrides,
  };
}

describe('generateSlots — semana de una clínica', () => {
  it('ofrece 8 horarios por día hábil y nada el fin de semana', () => {
    const slots = generateSlots(query());
    expect(slots).toHaveLength(40);
    expect(slots.map((s) => local(s.start)).filter((l) => l.startsWith('Sat') || l.startsWith('Sun'))).toEqual([]);
    expect(local(slots[0]!.start)).toBe('Mon 09:00');
    expect(local(slots.at(-1)!.start)).toBe('Fri 12:30');
  });

  it('expresa la hora local en UTC (Quito es UTC-5)', () => {
    const [first] = generateSlots(query());
    expect(new Date(first!.start).toISOString()).toBe('2026-10-19T14:00:00.000Z');
    expect(first!.end - first!.start).toBe(30 * 60_000);
  });

  it('Galápagos es UTC-6', () => {
    const [first] = generateSlots(query({ timezone: 'Pacific/Galapagos' }));
    expect(new Date(first!.start).toISOString()).toBe('2026-10-19T15:00:00.000Z');
  });
});

describe('generateSlots — buffers y ocupación (R-01, R-08)', () => {
  it('el buffer cuenta para caber en el horario laboral', () => {
    const slots = generateSlots(
      query({
        toDate: '2026-10-19',
        service: { durationMin: 30, bufferBeforeMin: 0, bufferAfterMin: 10, resources: [{ resourceId: DRA }] },
      }),
    );
    expect(slots.map((s) => local(s.start))).toEqual([
      'Mon 09:00', 'Mon 09:30', 'Mon 10:00', 'Mon 10:30', 'Mon 11:00', 'Mon 11:30', 'Mon 12:00',
    ]);
  });

  it('una reserva existente con buffer bloquea los horarios que la tocan', () => {
    const existing = occupiedSpan(at('2026-10-19T10:00'), 30, 0, 10);
    const slots = generateSlots(
      query({
        toDate: '2026-10-19',
        service: { durationMin: 30, bufferBeforeMin: 0, bufferAfterMin: 10, resources: [{ resourceId: DRA }] },
        busy: [{ resourceId: DRA, ...existing }],
      }),
    );
    expect(slots.map((s) => local(s.start))).toEqual(['Mon 09:00', 'Mon 11:00', 'Mon 11:30', 'Mon 12:00']);
  });

  it('permite reservas contiguas: [10:00, 10:30) no choca con 10:30', () => {
    const slots = generateSlots(
      query({
        toDate: '2026-10-19',
        busy: [{ resourceId: DRA, start: at('2026-10-19T10:00'), end: at('2026-10-19T10:30') }],
      }),
    );
    const times = slots.map((s) => local(s.start));
    expect(times).toContain('Mon 09:30');
    expect(times).toContain('Mon 10:30');
    expect(times).not.toContain('Mon 10:00');
  });

  it('la ocupación de otro profesional no afecta', () => {
    const slots = generateSlots(
      query({
        toDate: '2026-10-19',
        busy: [{ resourceId: LIC, start: at('2026-10-19T09:00'), end: at('2026-10-19T13:00') }],
      }),
    );
    expect(slots).toHaveLength(8);
  });

  it('respeta la duración específica de un profesional', () => {
    const slots = generateSlots(
      query({
        toDate: '2026-10-19',
        service: { durationMin: 30, bufferBeforeMin: 0, bufferAfterMin: 0, resources: [{ resourceId: DRA, durationOverrideMin: 60 }] },
      }),
    );
    expect(slots.at(-1)!.end - slots.at(-1)!.start).toBe(60 * 60_000);
    expect(local(slots.at(-1)!.start)).toBe('Mon 12:00');
  });
});

describe('generateSlots — reglas y excepciones', () => {
  it('las reglas propias de un profesional reemplazan las del local', () => {
    const slots = generateSlots(
      query({
        toDate: '2026-10-19',
        service: { durationMin: 30, bufferBeforeMin: 0, bufferAfterMin: 0, resources: [{ resourceId: DRA }, { resourceId: LIC }] },
        rules: [...weekdays(null, '09:00', '13:00'), ...weekdays(LIC, '15:00', '16:00')],
      }),
    );
    expect(slots.filter((s) => s.resourceId === DRA)).toHaveLength(8);
    expect(slots.filter((s) => s.resourceId === LIC).map((s) => local(s.start))).toEqual(['Mon 15:00', 'Mon 15:30']);
  });

  it('un feriado del local bloquea a todos', () => {
    const slots = generateSlots(
      query({
        exceptions: [{ resourceId: null, kind: 'block', start: at('2026-10-21T00:00'), end: at('2026-10-22T00:00') }],
      }),
    );
    expect(slots).toHaveLength(32);
    expect(slots.some((s) => local(s.start).startsWith('Wed'))).toBe(false);
  });

  it('un bloqueo de un profesional no afecta a los demás', () => {
    const slots = generateSlots(
      query({
        toDate: '2026-10-19',
        service: { durationMin: 30, bufferBeforeMin: 0, bufferAfterMin: 0, resources: [{ resourceId: DRA }, { resourceId: LIC }] },
        exceptions: [{ resourceId: DRA, kind: 'block', start: at('2026-10-19T09:00'), end: at('2026-10-19T11:00') }],
      }),
    );
    expect(slots.filter((s) => s.resourceId === DRA)).toHaveLength(4);
    expect(slots.filter((s) => s.resourceId === LIC)).toHaveLength(8);
  });

  it('una apertura extraordinaria agrega horarios un sábado', () => {
    const slots = generateSlots(
      query({
        exceptions: [{ resourceId: DRA, kind: 'open', start: at('2026-10-24T09:00'), end: at('2026-10-24T11:00') }],
      }),
    );
    expect(slots.filter((s) => local(s.start).startsWith('Sat')).map((s) => local(s.start))).toEqual([
      'Sat 09:00', 'Sat 09:30', 'Sat 10:00', 'Sat 10:30',
    ]);
  });

  it('respeta la vigencia de una regla', () => {
    const rules = weekdays(null, '09:00', '13:00').map((r) => ({ ...r, validFrom: '2026-10-21', validUntil: '2026-10-22' }));
    const slots = generateSlots(query({ rules }));
    expect(new Set(slots.map((s) => local(s.start).slice(0, 3)))).toEqual(new Set(['Wed', 'Thu']));
  });

  it('filtra por el profesional que eligió el cliente', () => {
    const slots = generateSlots(
      query({
        service: { durationMin: 30, bufferBeforeMin: 0, bufferAfterMin: 0, resources: [{ resourceId: DRA }, { resourceId: LIC }] },
        resourceId: LIC,
      }),
    );
    expect(slots.every((s) => s.resourceId === LIC)).toBe(true);
    expect(slots).toHaveLength(40);
  });
});

describe('generateSlots — ventana de reserva (R-09)', () => {
  it('no ofrece horarios antes de la anticipación mínima', () => {
    const slots = generateSlots(
      query({ toDate: '2026-10-19', now: at('2026-10-19T08:00'), window: { minAdvanceMin: 120, maxAdvanceDays: 60 } }),
    );
    expect(local(slots[0]!.start)).toBe('Mon 10:00');
  });

  it('no ofrece horarios en el pasado', () => {
    const slots = generateSlots(query({ toDate: '2026-10-19', now: at('2026-10-19T11:15') }));
    expect(local(slots[0]!.start)).toBe('Mon 11:30');
  });

  it('no ofrece horarios más allá de la anticipación máxima', () => {
    const slots = generateSlots(query({ now: at('2026-10-19T08:00'), window: { minAdvanceMin: 0, maxAdvanceDays: 2 } }));
    const days = new Set(slots.map((s) => local(s.start).slice(0, 3)));
    expect(days).toEqual(new Set(['Mon', 'Tue']));
    expect(slots.every((s) => s.start <= at('2026-10-21T08:00'))).toBe(true);
  });
});

describe('generateSlots — cambio de horario (P9: no asumir que no hay DST)', () => {
  const NY = 'America/New_York';

  it('salta las horas locales que no existen y sigue el reloj de pared', () => {
    const slots = generateSlots(
      query({
        timezone: NY,
        fromDate: '2026-03-08',
        toDate: '2026-03-08',
        now: at('2026-03-01T00:00', NY),
        rules: [{ resourceId: null, weekday: 0, startsLocal: '01:00', endsLocal: '05:00', slotMinutes: 30 }],
      }),
    );
    expect(slots.map((s) => local(s.start, NY).slice(4))).toEqual(['01:00', '01:30', '03:00', '03:30', '04:00', '04:30']);
    expect(new Date(slots[2]!.start).toISOString()).toBe('2026-03-08T07:00:00.000Z');
  });
});

describe('groupSlotsByStart', () => {
  it('agrupa profesionales libres a la misma hora', () => {
    const slots = generateSlots(
      query({
        toDate: '2026-10-19',
        service: { durationMin: 30, bufferBeforeMin: 0, bufferAfterMin: 0, resources: [{ resourceId: DRA }, { resourceId: LIC }] },
      }),
    );
    const grouped = groupSlotsByStart(slots);
    expect(grouped).toHaveLength(8);
    expect(grouped[0]!.options.map((o) => o.resourceId)).toEqual([DRA, LIC]);
  });
});

import { DateTime } from 'luxon';

const MINUTE = 60_000;
const DAY = 86_400_000;

/** Half-open interval [start, end) in epoch milliseconds (UTC). */
export interface Span {
  start: number;
  end: number;
}

/** 0 = domingo … 6 = sábado, same as Postgres `extract(dow)`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface AvailabilityRule {
  /** null = applies to every resource of the location that has no rules of its own. */
  resourceId: string | null;
  weekday: Weekday;
  /** Local wall-clock time of the location, "HH:mm" or "HH:mm:ss". */
  startsLocal: string;
  endsLocal: string;
  slotMinutes: number;
  /** Local dates "YYYY-MM-DD", inclusive. */
  validFrom?: string | null;
  validUntil?: string | null;
}

export interface AvailabilityException extends Span {
  resourceId: string | null;
  kind: 'block' | 'open';
}

/** Time a resource is already occupied. Must already include buffers (booking_resource.span). */
export interface Busy extends Span {
  resourceId: string;
}

export interface ServiceSpec {
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  resources: ReadonlyArray<{ resourceId: string; durationOverrideMin?: number | null }>;
}

export interface BookingWindow {
  minAdvanceMin: number;
  maxAdvanceDays: number;
}

export interface AvailabilityQuery {
  timezone: string;
  /** Local dates "YYYY-MM-DD", inclusive. */
  fromDate: string;
  toDate: string;
  now: number;
  service: ServiceSpec;
  rules: ReadonlyArray<AvailabilityRule>;
  exceptions: ReadonlyArray<AvailabilityException>;
  busy: ReadonlyArray<Busy>;
  window: BookingWindow;
  /** The customer picked a specific professional. */
  resourceId?: string;
  /** Grid step used inside `open` exceptions, which carry no step of their own. */
  openSlotMinutes?: number;
}

/** What the customer sees: [start, end) without buffers, on one resource. */
export interface Slot extends Span {
  resourceId: string;
}

export function occupiedSpan(start: number, durationMin: number, bufferBeforeMin: number, bufferAfterMin: number): Span {
  return {
    start: start - bufferBeforeMin * MINUTE,
    end: start + (durationMin + bufferAfterMin) * MINUTE,
  };
}

export function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

interface WorkInterval extends Span {
  /** Local date and minute-of-day the grid is anchored to, so steps follow the wall clock. */
  date: DateTime;
  startMinuteOfDay: number;
  endMinuteOfDay: number;
  step: number;
}

function parseLocalTime(value: string): number {
  const [h, m] = value.split(':');
  return Number(h) * 60 + Number(m);
}

/** Returns null when the wall-clock time does not exist in that zone (DST gap). */
function localToUtc(date: DateTime, minuteOfDay: number): number | null {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  if (hour === 24 && minute === 0) {
    const next = date.plus({ days: 1 });
    return localToUtc(next, 0);
  }
  const dt = DateTime.fromObject(
    { year: date.year, month: date.month, day: date.day, hour, minute },
    { zone: date.zone },
  );
  if (!dt.isValid || dt.hour !== hour || dt.minute !== minute) return null;
  return dt.toMillis();
}

function weekdayOf(date: DateTime): Weekday {
  return (date.weekday % 7) as Weekday;
}

function ruleAppliesOn(rule: AvailabilityRule, date: DateTime): boolean {
  if (rule.weekday !== weekdayOf(date)) return false;
  const iso = date.toISODate();
  if (iso === null) return false;
  if (rule.validFrom && iso < rule.validFrom) return false;
  if (rule.validUntil && iso > rule.validUntil) return false;
  return true;
}

function workIntervalsFor(resourceId: string, q: AvailabilityQuery): WorkInterval[] {
  const own = q.rules.filter((r) => r.resourceId === resourceId);
  const rules = own.length > 0 ? own : q.rules.filter((r) => r.resourceId === null);

  const first = DateTime.fromISO(q.fromDate, { zone: q.timezone }).startOf('day');
  const last = DateTime.fromISO(q.toDate, { zone: q.timezone }).startOf('day');
  if (!first.isValid || !last.isValid) throw new Error('fromDate/toDate inválidas o zona horaria desconocida');

  const intervals: WorkInterval[] = [];
  for (let date = first; date <= last; date = date.plus({ days: 1 })) {
    for (const rule of rules) {
      if (!ruleAppliesOn(rule, date)) continue;
      const startMinuteOfDay = parseLocalTime(rule.startsLocal);
      const endMinuteOfDay = parseLocalTime(rule.endsLocal);
      const start = localToUtc(date, startMinuteOfDay);
      const end = localToUtc(date, endMinuteOfDay);
      if (start === null || end === null || end <= start) continue;
      intervals.push({ start, end, date, startMinuteOfDay, endMinuteOfDay, step: rule.slotMinutes });
    }
  }

  const rangeStart = first.toMillis();
  const rangeEnd = last.plus({ days: 1 }).toMillis();
  for (const ex of q.exceptions) {
    if (ex.kind !== 'open') continue;
    if (ex.resourceId !== null && ex.resourceId !== resourceId) continue;
    if (!overlaps(ex, { start: rangeStart, end: rangeEnd })) continue;
    const local = DateTime.fromMillis(ex.start, { zone: q.timezone });
    intervals.push({
      start: ex.start,
      end: ex.end,
      date: local.startOf('day'),
      startMinuteOfDay: local.hour * 60 + local.minute,
      endMinuteOfDay: local.hour * 60 + local.minute + Math.floor((ex.end - ex.start) / MINUTE),
      step: q.openSlotMinutes ?? 30,
    });
  }

  return intervals;
}

/**
 * Bookable slots for one service. A slot is offered only if its whole occupied span
 * (buffers included, R-08) fits inside working time and touches no busy time or block.
 */
export function generateSlots(q: AvailabilityQuery): Slot[] {
  const earliest = q.now + q.window.minAdvanceMin * MINUTE;
  const latest = q.now + q.window.maxAdvanceDays * DAY;
  const candidates = q.resourceId
    ? q.service.resources.filter((r) => r.resourceId === q.resourceId)
    : q.service.resources;

  const seen = new Set<string>();
  const slots: Slot[] = [];

  for (const { resourceId, durationOverrideMin } of candidates) {
    const duration = durationOverrideMin ?? q.service.durationMin;
    const obstacles: Span[] = [
      ...q.busy.filter((b) => b.resourceId === resourceId),
      ...q.exceptions.filter((e) => e.kind === 'block' && (e.resourceId === null || e.resourceId === resourceId)),
    ];

    for (const interval of workIntervalsFor(resourceId, q)) {
      for (let m = interval.startMinuteOfDay; m < interval.endMinuteOfDay; m += interval.step) {
        const start = localToUtc(interval.date, m);
        if (start === null) continue;
        if (start < earliest || start > latest) continue;

        const occupied = occupiedSpan(start, duration, q.service.bufferBeforeMin, q.service.bufferAfterMin);
        if (occupied.start < interval.start || occupied.end > interval.end) continue;
        if (obstacles.some((o) => overlaps(o, occupied))) continue;

        const key = `${resourceId}|${start}`;
        if (seen.has(key)) continue;
        seen.add(key);
        slots.push({ resourceId, start, end: start + duration * MINUTE });
      }
    }
  }

  return slots.sort((a, b) => a.start - b.start || a.resourceId.localeCompare(b.resourceId));
}

export interface SlotOption {
  start: number;
  options: Array<{ resourceId: string; end: number }>;
}

/** Collapses per-resource slots into the times the customer chooses from. */
export function groupSlotsByStart(slots: ReadonlyArray<Slot>): SlotOption[] {
  const byStart = new Map<number, SlotOption>();
  for (const s of slots) {
    const entry = byStart.get(s.start) ?? { start: s.start, options: [] };
    entry.options.push({ resourceId: s.resourceId, end: s.end });
    byStart.set(s.start, entry);
  }
  return [...byStart.values()].sort((a, b) => a.start - b.start);
}

import { afterAll, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import {
  generateSlots,
  groupSlotsByStart,
  occupiedSpan,
  type AvailabilityException,
  type AvailabilityQuery,
  type AvailabilityRule,
  type Busy,
  type Weekday,
} from '@superconfirma/core';
import { errorCode, inTx, range, sql, tokenHash, type Tx } from './helpers.ts';

/** Criterio de terminado de M0: disponibilidad de una semana desde la semilla + la base rechaza el solape. */

const BUSINESS = '00000000-0000-4000-b000-000000000001';
const LOCATION = '00000000-0000-4000-c000-000000000001';
const LIMPIEZA = '00000000-0000-4000-e000-000000000001';
const DRA = '00000000-0000-4000-d000-000000000001';
const LIC = '00000000-0000-4000-d000-000000000002';

afterAll(() => sql.end());

async function loadQuery(tx: Tx, serviceId: string, fromDate: string, toDate: string, now: number): Promise<AvailabilityQuery> {
  const [loc] = await tx`select timezone, min_advance_min, max_advance_days from location where id = ${LOCATION}`;
  const [svc] = await tx`select duration_min, buffer_before_min, buffer_after_min from service where id = ${serviceId}`;
  const resources = await tx`
    select resource_id, duration_override_min from service_resource sr
    join resource r on r.id = sr.resource_id
    where sr.service_id = ${serviceId} and r.active order by r.sort_order`;
  const rules = await tx`
    select resource_id, weekday, starts_local::text, ends_local::text, slot_minutes, valid_from::text, valid_until::text
    from availability_rule where location_id = ${LOCATION} and mode = 'slot'`;
  const exceptions = await tx`
    select resource_id, kind, lower(span) as s, upper(span) as e
    from availability_exception where location_id = ${LOCATION}`;
  const busy = await tx`
    select br.resource_id, lower(br.span) as s, upper(br.span) as e
    from booking_resource br join booking b on b.id = br.booking_id
    where b.location_id = ${LOCATION} and br.blocking`;

  return {
    timezone: loc!.timezone,
    fromDate,
    toDate,
    now,
    window: { minAdvanceMin: loc!.min_advance_min, maxAdvanceDays: loc!.max_advance_days },
    service: {
      durationMin: svc!.duration_min,
      bufferBeforeMin: svc!.buffer_before_min,
      bufferAfterMin: svc!.buffer_after_min,
      resources: resources.map((r) => ({ resourceId: r.resource_id, durationOverrideMin: r.duration_override_min })),
    },
    rules: rules.map(
      (r): AvailabilityRule => ({
        resourceId: r.resource_id,
        weekday: r.weekday as Weekday,
        startsLocal: r.starts_local,
        endsLocal: r.ends_local,
        slotMinutes: r.slot_minutes,
        validFrom: r.valid_from,
        validUntil: r.valid_until,
      }),
    ),
    exceptions: exceptions.map(
      (e): AvailabilityException => ({ resourceId: e.resource_id, kind: e.kind, start: e.s.getTime(), end: e.e.getTime() }),
    ),
    busy: busy.map((b): Busy => ({ resourceId: b.resource_id, start: b.s.getTime(), end: b.e.getTime() })),
  };
}

const quito = (iso: string) => DateTime.fromISO(iso, { zone: 'America/Guayaquil' }).toMillis();
const label = (ms: number) => DateTime.fromMillis(ms, { zone: 'America/Guayaquil' }).toFormat('ccc HH:mm');

describe('M0 · terminado', () => {
  it('genera la semana de la clínica sembrada y la base rechaza el solape', async () => {
    await inTx(async (tx) => {
      const now = quito('2026-10-18T20:00');
      const week = await loadQuery(tx, LIMPIEZA, '2026-10-19', '2026-10-25', now);
      const slots = generateSlots(week);

      // Limpieza: 45 min + 15 de buffer = 60 min reales, grilla de 30.
      // Dra.: L-V 09-13 (7 inicios: 09:00…12:00) y 14-18 (7) = 14/día × 5 = 70.
      // Lic.: horario propio mar/jue 14-19 (9 inicios) y sáb 09-12 (5 inicios) = 23.
      expect(slots.filter((s) => s.resourceId === DRA)).toHaveLength(70);
      expect(slots.filter((s) => s.resourceId === LIC)).toHaveLength(23);
      expect(label(slots[0]!.start)).toBe('Mon 09:00');
      expect(slots.some((s) => label(s.start) === 'Mon 12:30' && s.resourceId === DRA)).toBe(false);

      // Reservar el primer horario de la Dra. como lo haría la API.
      const first = slots.find((s) => s.resourceId === DRA)!;
      const occ = occupiedSpan(first.start, 45, 0, 15);
      const bookingId = crypto.randomUUID();
      await tx`
        insert into booking (id, business_id, location_id, service_id, status, span, public_token_hash)
        values (${bookingId}, ${BUSINESS}, ${LOCATION}, ${LIMPIEZA}, 'pending',
                ${range(new Date(first.start), new Date(first.end))}, ${tokenHash()})`;
      await tx`
        insert into booking_resource (business_id, booking_id, resource_id, span)
        values (${BUSINESS}, ${bookingId}, ${DRA}, ${range(new Date(occ.start), new Date(occ.end))})`;

      // El horario deja de aparecer para los demás…
      const after = generateSlots(await loadQuery(tx, LIMPIEZA, '2026-10-19', '2026-10-19', now));
      const mondayDra = after.filter((s) => s.resourceId === DRA).map((s) => label(s.start));
      expect(mondayDra).not.toContain('Mon 09:00');
      expect(mondayDra).not.toContain('Mon 09:30');
      expect(mondayDra).toContain('Mon 10:00');
      // …pero sigue libre con el otro profesional si él atiende ese día (el lunes no).
      expect(groupSlotsByStart(after).find((g) => g.start === first.start)).toBeUndefined();

      // …y aunque alguien se salte el motor, Postgres no deja reservarlo dos veces.
      const second = crypto.randomUUID();
      const code = await errorCode(tx, async (sp) => {
        await sp`
          insert into booking (id, business_id, location_id, service_id, status, span, public_token_hash)
          values (${second}, ${BUSINESS}, ${LOCATION}, ${LIMPIEZA}, 'pending',
                  ${range(new Date(first.start), new Date(first.end))}, ${tokenHash()})`;
        await sp`
          insert into booking_resource (business_id, booking_id, resource_id, span)
          values (${BUSINESS}, ${second}, ${DRA}, ${range(new Date(occ.start), new Date(occ.end))})`;
      });
      expect(code).toBe('23P01');
    });
  });

  it('respeta la anticipación mínima configurada en el local (2 horas)', async () => {
    await inTx(async (tx) => {
      const slots = generateSlots(await loadQuery(tx, LIMPIEZA, '2026-10-19', '2026-10-19', quito('2026-10-19T09:10')));
      expect(label(slots[0]!.start)).toBe('Mon 11:30');
    });
  });
});

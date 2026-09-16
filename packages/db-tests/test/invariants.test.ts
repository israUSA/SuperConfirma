import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { BOOKING_STATUSES, canTransition, isBlocking, occupiedSpan, type BookingStatus } from '@superconfirma/core';
import { createTenant, errorCode, inTx, range, sql, tokenHash, type Tenant, type Tx, first } from './helpers.ts';

/**
 * P2: each test goes around the application and talks SQL directly,
 * expecting Postgres itself to refuse the violation.
 */

afterAll(() => sql.end());

const EXCLUSION = '23P01';
const UNIQUE = '23505';
const CHECK = '23514';
const FK = '23503';

async function book(
  tx: Tx,
  t: Tenant,
  opts: { start: string; end: string; occupiedEnd?: string; status?: BookingStatus; resourceId?: string; units?: number; holdExpiresAt?: string },
): Promise<string> {
  const id = randomUUID();
  await tx`
    insert into booking (id, business_id, location_id, service_id, status, span, public_token_hash, hold_expires_at)
    values (${id}, ${t.businessId}, ${t.locationId}, ${t.serviceId}, ${opts.status ?? 'confirmed'},
            ${range(opts.start, opts.end)}, ${tokenHash()}, ${opts.holdExpiresAt ?? null})`;
  await tx`
    insert into booking_resource (business_id, booking_id, resource_id, span, units)
    values (${t.businessId}, ${id}, ${opts.resourceId ?? t.resourceId},
            ${range(opts.start, opts.occupiedEnd ?? opts.end)}, ${opts.units ?? 1})`;
  return id;
}

describe('R-01 · sin solapes en el mismo recurso', () => {
  it('rechaza una reserva que se solapa', async () => {
    await inTx(async (tx) => {
      const t = await createTenant(tx, 'A');
      await book(tx, t, { start: '2026-11-02T14:00Z', end: '2026-11-02T14:30Z' });
      const code = await errorCode(tx, (sp) => book(sp, t, { start: '2026-11-02T14:15Z', end: '2026-11-02T14:45Z' }));
      expect(code).toBe(EXCLUSION);
    });
  });

  it('acepta reservas contiguas [10:00, 10:30) + [10:30, 11:00)', async () => {
    await inTx(async (tx) => {
      const t = await createTenant(tx, 'A');
      await book(tx, t, { start: '2026-11-02T15:00Z', end: '2026-11-02T15:30Z' });
      await book(tx, t, { start: '2026-11-02T15:30Z', end: '2026-11-02T16:00Z' });
    });
  });

  it('acepta el mismo horario en otro recurso', async () => {
    await inTx(async (tx) => {
      const t = await createTenant(tx, 'A');
      const other = randomUUID();
      await tx`insert into resource (id, business_id, location_id, name) values (${other}, ${t.businessId}, ${t.locationId}, 'Otro')`;
      await book(tx, t, { start: '2026-11-02T14:00Z', end: '2026-11-02T14:30Z' });
      await book(tx, t, { start: '2026-11-02T14:00Z', end: '2026-11-02T14:30Z', resourceId: other });
    });
  });

  it('la columna blocking no se puede falsear desde un update', async () => {
    await inTx(async (tx) => {
      const t = await createTenant(tx, 'A');
      const id = await book(tx, t, { start: '2026-11-02T14:00Z', end: '2026-11-02T14:30Z' });
      await tx`update booking_resource set blocking = false, exclusive = false where booking_id = ${id}`;
      const [row] = await tx`select blocking, exclusive from booking_resource where booking_id = ${id}`;
      expect(row).toEqual({ blocking: true, exclusive: true });
      const code = await errorCode(tx, (sp) => book(sp, t, { start: '2026-11-02T14:00Z', end: '2026-11-02T14:30Z' }));
      expect(code).toBe(EXCLUSION);
    });
  });
});

describe('R-03 · cancelar libera el horario', () => {
  it.each(['cancelled', 'rescheduled'] as const)('una reserva %s deja de bloquear', async (status) => {
    await inTx(async (tx) => {
      const t = await createTenant(tx, 'A');
      const id = await book(tx, t, { start: '2026-11-02T14:00Z', end: '2026-11-02T14:30Z' });
      await tx`update booking set status = ${status} where id = ${id}`;
      await book(tx, t, { start: '2026-11-02T14:00Z', end: '2026-11-02T14:30Z' });
    });
  });

  it('una cancelada no se puede reactivar (la máquina de estados vive también en la base)', async () => {
    await inTx(async (tx) => {
      const t = await createTenant(tx, 'A');
      const id = await book(tx, t, { start: '2026-11-02T14:00Z', end: '2026-11-02T14:30Z' });
      await tx`update booking set status = 'cancelled' where id = ${id}`;
      expect(await errorCode(tx, (sp) => sp`update booking set status = 'confirmed' where id = ${id}`)).toBe(CHECK);
    });
  });

  it('registra la hora de confirmación y de cancelación', async () => {
    await inTx(async (tx) => {
      const t = await createTenant(tx, 'A');
      const id = await book(tx, t, { start: '2026-11-02T14:00Z', end: '2026-11-02T14:30Z', status: 'pending' });
      await tx`update booking set status = 'confirmed' where id = ${id}`;
      await tx`update booking set status = 'cancelled' where id = ${id}`;
      const [row] = await tx`select confirmed_at, cancelled_at from booking where id = ${id}`;
      expect(row!.confirmed_at).toBeInstanceOf(Date);
      expect(row!.cancelled_at).toBeInstanceOf(Date);
    });
  });
});

describe('R-04 · las retenciones vencen', () => {
  it('expire_holds libera solo las vencidas', async () => {
    await inTx(async (tx) => {
      const t = await createTenant(tx, 'A');
      const now = '2026-11-01T12:00:00Z';
      const expired = await book(tx, t, {
        start: '2026-11-02T14:00Z', end: '2026-11-02T14:30Z', status: 'hold', holdExpiresAt: '2026-11-01T11:59:00Z',
      });
      const alive = await book(tx, t, {
        start: '2026-11-02T15:00Z', end: '2026-11-02T15:30Z', status: 'hold', holdExpiresAt: '2026-11-01T12:05:00Z',
      });

      const { n } = first(await tx`select app_private.expire_holds(${now}::timestamptz) as n`);
      expect(n).toBeGreaterThanOrEqual(1);

      const rows = await tx<{ id: string; status: string; cancelled_by: string | null }[]>`
        select id, status, cancelled_by from booking where id in ${tx([expired, alive])}`;
      expect(rows.find((r) => r.id === expired)).toMatchObject({ status: 'cancelled', cancelled_by: 'system' });
      expect(rows.find((r) => r.id === alive)).toMatchObject({ status: 'hold' });

      await book(tx, t, { start: '2026-11-02T14:00Z', end: '2026-11-02T14:30Z' });
      expect(await errorCode(tx, (sp) => book(sp, t, { start: '2026-11-02T15:00Z', end: '2026-11-02T15:30Z' }))).toBe(EXCLUSION);
    });
  });

  it('una retención sin vencimiento es inválida', async () => {
    await inTx(async (tx) => {
      const t = await createTenant(tx, 'A');
      const code = await errorCode(tx, (sp) => book(sp, t, { start: '2026-11-02T14:00Z', end: '2026-11-02T14:30Z', status: 'hold' }));
      expect(code).toBe(CHECK);
    });
  });
});

describe('R-02 · capacidad N', () => {
  it('llena la sala hasta su capacidad y rechaza una más', async () => {
    await inTx(async (tx) => {
      const t = await createTenant(tx, 'A');
      const slot = { start: '2026-11-02T14:00Z', end: '2026-11-02T15:00Z', resourceId: t.sharedResourceId };
      await book(tx, t, slot);
      await book(tx, t, { ...slot, units: 2 });
      expect(await errorCode(tx, (sp) => book(sp, t, slot))).toBe(EXCLUSION);
    });
  });

  it('mide la ocupación simultánea, no la suma de todo lo que toca', async () => {
    await inTx(async (tx) => {
      const t = await createTenant(tx, 'A');
      await tx`update resource set capacity = 2 where id = ${t.sharedResourceId}`;
      const r = t.sharedResourceId;
      await book(tx, t, { start: '2026-11-02T14:00Z', end: '2026-11-02T15:00Z', resourceId: r });
      await book(tx, t, { start: '2026-11-02T15:00Z', end: '2026-11-02T16:00Z', resourceId: r });
      // Toca a las dos, pero nunca hay más de 2 a la vez.
      await book(tx, t, { start: '2026-11-02T14:00Z', end: '2026-11-02T16:00Z', resourceId: r });
      // Ahora sí habría 3 entre 14:30 y 15:30.
      const code = await errorCode(tx, (sp) => book(sp, t, { start: '2026-11-02T14:30Z', end: '2026-11-02T15:30Z', resourceId: r }));
      expect(code).toBe(EXCLUSION);
    });
  });

  it('no acepta más unidades que la capacidad en una sola reserva', async () => {
    await inTx(async (tx) => {
      const t = await createTenant(tx, 'A');
      const code = await errorCode(tx, (sp) =>
        book(sp, t, { start: '2026-11-02T14:00Z', end: '2026-11-02T15:00Z', resourceId: t.sharedResourceId, units: 4 }),
      );
      expect(code).toBe(EXCLUSION);
    });
  });

  it('bajar la capacidad a 1 falla si ya hay reservas simultáneas', async () => {
    await inTx(async (tx) => {
      const t = await createTenant(tx, 'A');
      const slot = { start: '2026-11-02T14:00Z', end: '2026-11-02T15:00Z', resourceId: t.sharedResourceId };
      await book(tx, t, slot);
      await book(tx, t, slot);
      expect(await errorCode(tx, (sp) => sp`update resource set capacity = 1 where id = ${t.sharedResourceId}`)).toBe(EXCLUSION);
    });
  });
});

describe('R-05 · un mensaje no sale dos veces', () => {
  it('rechaza el mismo tipo y ventana para la misma reserva', async () => {
    await inTx(async (tx) => {
      const t = await createTenant(tx, 'A');
      const insert = (sp: Tx) => sp`
        insert into message_log (business_id, booking_id, channel, kind, window_key, category)
        values (${t.businessId}, ${t.bookingId}, 'whatsapp', 'reminder_24h', '2026-10-18', 'UTILITY')`;
      await insert(tx);
      expect(await errorCode(tx, insert)).toBe(UNIQUE);
    });
  });

  it('P5: nada se marca como enviado sin costo y país', async () => {
    await inTx(async (tx) => {
      const t = await createTenant(tx, 'A');
      const code = await errorCode(tx, (sp) => sp`
        insert into message_log (business_id, booking_id, channel, kind, window_key, category, status)
        values (${t.businessId}, ${t.bookingId}, 'whatsapp', 'reminder_2h', 'x', 'UTILITY', 'sent')`);
      expect(code).toBe(CHECK);
    });
  });
});

describe('R-08 · los buffers ocupan tiempo real', () => {
  it('una reserva que cae en el buffer de otra es rechazada', async () => {
    await inTx(async (tx) => {
      const t = await createTenant(tx, 'A');
      const start = Date.parse('2026-11-02T14:00Z');
      const occ = occupiedSpan(start, 30, 0, 10);
      await book(tx, t, {
        start: new Date(start).toISOString(),
        end: new Date(start + 30 * 60_000).toISOString(),
        occupiedEnd: new Date(occ.end).toISOString(),
      });
      const code = await errorCode(tx, (sp) => book(sp, t, { start: '2026-11-02T14:30Z', end: '2026-11-02T15:00Z' }));
      expect(code).toBe(EXCLUSION);
      await book(tx, t, { start: '2026-11-02T14:40Z', end: '2026-11-02T15:10Z' });
    });
  });
});

describe('integridad entre negocios y datos válidos', () => {
  it('una reserva de A no puede ocupar un recurso de B', async () => {
    await inTx(async (tx) => {
      const a = await createTenant(tx, 'A');
      const b = await createTenant(tx, 'B');
      const code = await errorCode(tx, (sp) => sp`
        insert into booking_resource (business_id, booking_id, resource_id, span)
        values (${a.businessId}, ${a.bookingId}, ${b.resourceId}, ${range('2026-11-03T14:00Z', '2026-11-03T14:30Z')})`);
      expect(code).toBe(FK);
    });
  });

  it('una reserva no puede apuntar al cliente de otro negocio', async () => {
    await inTx(async (tx) => {
      const a = await createTenant(tx, 'A');
      const b = await createTenant(tx, 'B');
      expect(await errorCode(tx, (sp) => sp`update booking set customer_id = ${b.customerId} where id = ${a.bookingId}`)).toBe(FK);
    });
  });

  it.each(['America/Galapagos', 'Quito', 'UTC+5', 'EST'])('rechaza la zona horaria %s', async (tz) => {
    await inTx(async (tx) => {
      const t = await createTenant(tx, 'A');
      expect(await errorCode(tx, (sp) => sp`update location set timezone = ${tz} where id = ${t.locationId}`)).toBe(CHECK);
    });
  });

  it.each(['America/Guayaquil', 'Pacific/Galapagos'])('acepta la zona horaria %s', async (tz) => {
    await inTx(async (tx) => {
      const t = await createTenant(tx, 'A');
      await tx`update location set timezone = ${tz} where id = ${t.locationId}`;
    });
  });

  it('rechaza rangos vacíos, invertidos o cerrados', async () => {
    await inTx(async (tx) => {
      const t = await createTenant(tx, 'A');
      for (const span of ['empty', '[2026-11-02 14:00Z,2026-11-02 14:30Z]', '(,2026-11-02 14:30Z)']) {
        const code = await errorCode(tx, (sp) => sp`update booking set span = ${span} where id = ${t.bookingId}`);
        expect(code, span).toBe(CHECK);
      }
    });
  });
});

describe('paridad entre packages/core y la base', () => {
  it('isBlocking() == booking_status_blocks()', async () => {
    const rows = await sql<{ s: BookingStatus; b: boolean }[]>`
      select s, app_private.booking_status_blocks(s) as b from unnest(enum_range(null::booking_status)) s`;
    expect(rows.map((r) => r.s).sort()).toEqual([...BOOKING_STATUSES].sort());
    for (const r of rows) expect(r.b, r.s).toBe(isBlocking(r.s));
  });

  it('canTransition() == booking_transition_allowed()', async () => {
    const rows = await sql<{ f: BookingStatus; t: BookingStatus; ok: boolean }[]>`
      select f, t, app_private.booking_transition_allowed(f, t) as ok
      from unnest(enum_range(null::booking_status)) f, unnest(enum_range(null::booking_status)) t`;
    expect(rows).toHaveLength(BOOKING_STATUSES.length ** 2);
    for (const r of rows) expect(r.ok, `${r.f} -> ${r.t}`).toBe(canTransition(r.f, r.t));
  });
});

import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp, maskUrl } from '../src/app.ts';
import { createDb } from '../src/db.ts';
import { MemoryEmailSender } from '../src/email/sender.ts';
import {
  BOTOX, DATABASE_URL, DRA, LIC, LIMPIEZA, LOCATION, SLUG, SUNDAY_EVENING, WEB,
  availableStarts, book, complete, hold, sql, tokenFrom, withApp,
} from './harness.ts';

afterAll(() => sql.end());

const MON_0900 = '2026-10-19T14:00:00.000Z';
const MON_0930 = '2026-10-19T14:30:00.000Z';
const MON_1000 = '2026-10-19T15:00:00.000Z';
const TUE_1400 = '2026-10-20T19:00:00.000Z';

describe('catálogo público', () => {
  it('expone servicios y profesionales sin datos internos', async () => {
    await withApp(async ({ app }) => {
      const res = await app.inject(`/v1/public/${SLUG}`);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.business).toEqual({ slug: SLUG, name: 'Aura Estética Avanzada' });
      expect(body.services).toHaveLength(3);
      expect(body.resources.map((r: { name: string }) => r.name)).toEqual(['Dra. Valeria Paredes', 'Lic. Mateo Andrade']);
      expect(body.locations[0].bookingWindow).toEqual({ minAdvanceMin: 120, maxAdvanceDays: 30 });
      expect(res.body).not.toMatch(/buffer|sensitive|account|allowed_origins/);
    });
  });

  it('404 para un negocio que no existe y 400 para un slug inválido', async () => {
    await withApp(async ({ app }) => {
      expect((await app.inject('/v1/public/no-existe')).json()).toEqual({ error: 'business_not_found' });
      expect((await app.inject('/v1/public/No%20Valido')).statusCode).toBe(400);
    });
  });
});

describe('disponibilidad', () => {
  it('agrupa los profesionales libres a la misma hora', async () => {
    await withApp(async ({ app }) => {
      const res = await app.inject({
        url: `/v1/public/${SLUG}/availability?locationId=${LOCATION}&serviceId=${LIMPIEZA}&from=2026-10-20&to=2026-10-20`,
      });
      const tuesday = res.json();
      expect(tuesday.timezone).toBe('America/Guayaquil');
      const at1400 = tuesday.slots.find((s: { start: string }) => s.start === TUE_1400);
      expect(at1400.options.map((o: { resourceId: string }) => o.resourceId)).toEqual([DRA, LIC]);
    });
  });

  it('rechaza rangos de más de un mes y servicios de otro local', async () => {
    await withApp(async ({ app }) => {
      const long = await app.inject(
        `/v1/public/${SLUG}/availability?locationId=${LOCATION}&serviceId=${LIMPIEZA}&from=2026-10-01&to=2026-12-01`,
      );
      expect(long.json()).toEqual({ error: 'date_range_too_long' });
      const other = await app.inject(
        `/v1/public/${SLUG}/availability?locationId=${LOCATION}&serviceId=${randomUUID()}&from=2026-10-19&to=2026-10-19`,
      );
      expect(other.json()).toEqual({ error: 'service_not_found' });
    });
  });
});

describe('flujo completo de reserva (HU-03)', () => {
  it('retiene, completa, confirma por correo y quita el horario para los demás', async () => {
    await withApp(async ({ app, email, q, flush }) => {
      expect(await availableStarts(app, '2026-10-19')).toContain(MON_0900);

      const held = await hold(app, MON_0900, { source: 'widget' });
      expect(held.statusCode).toBe(201);
      const h = held.json();
      expect(h).toMatchObject({ resourceId: DRA, start: MON_0900, holdExpiresAt: '2026-10-19T01:10:00.000Z' });
      expect(h.consent.text).toBe('Acepto recibir confirmaciones y recordatorios de esta cita por WhatsApp');

      const after = await availableStarts(app, '2026-10-19');
      expect(after).not.toContain(MON_0900);
      expect(after).not.toContain(MON_0930); // 45 min + 15 de buffer
      expect(after).toContain(MON_1000);

      const done = await complete(app, h.token, { source: 'widget' });
      expect(done.statusCode).toBe(200);
      expect(done.json()).toMatchObject({ status: 'pending', manageUrl: `${WEB}/gestionar/${h.token}` });
      await flush();

      const [row] = await q`
        select b.status, b.source, b.hold_expires_at, ci.phone_e164, c.name, co.exact_text, co.terms_version
        from booking b join customer c on c.id = b.customer_id
        join contact_identity ci on ci.id = c.identity_id
        join consent co on co.identity_id = ci.id and co.business_id = b.business_id
        where b.id = ${done.json().bookingId}`;
      expect(row).toEqual({
        status: 'pending',
        source: 'widget',
        hold_expires_at: null,
        phone_e164: '+593998765432',
        name: 'Sofía Benítez',
        exact_text: 'Acepto recibir confirmaciones y recordatorios de esta cita por WhatsApp',
        terms_version: '2026-09-v1',
      });

      expect(email.outbox).toHaveLength(1);
      const [mail] = email.outbox;
      expect(mail!.to).toBe('sofia@example.com');
      expect(mail!.text).toContain('lunes 19 de octubre a las 09:00');
      expect(mail!.text).toContain('Con: Dra. Valeria Paredes');
      expect(mail!.text).toContain('Servicio: Limpieza Facial Profunda');
      expect(mail!.text).toContain(`${WEB}/gestionar/${h.token}`);
      expect(mail!.attachments![0]!.content).toContain('DTSTART:20261019T140000Z');

      const [log] = await q`
        select channel, kind, status, country, cost_estimate_micros from message_log
        where booking_id = ${done.json().bookingId}`;
      expect(log).toEqual({ channel: 'email', kind: 'confirmation', status: 'sent', country: 'EC', cost_estimate_micros: '0' });
    });
  });

  it('completar dos veces no duplica la reserva ni el correo (P3)', async () => {
    await withApp(async ({ app, email, flush }) => {
      const h = (await hold(app, MON_0900)).json();
      await complete(app, h.token);
      await flush();
      const again = await complete(app, h.token);
      await flush();
      expect(again.statusCode).toBe(200);
      expect(again.json().status).toBe('pending');
      expect(email.outbox).toHaveLength(1);
    });
  });

  it('no nombra un servicio sensible en el correo (P7)', async () => {
    await withApp(async ({ app, email, flush }) => {
      await book(app, MON_0900, { serviceId: BOTOX });
      await flush();
      expect(email.outbox[0]!.text).not.toContain('Botox');
      expect(email.outbox[0]!.subject).not.toContain('Botox');
      expect(email.outbox[0]!.attachments![0]!.content).not.toContain('Botox');
    });
  });

  it('sin correo no hay envío, y la reserva queda igual (P12)', async () => {
    await withApp(async ({ app, email, flush }) => {
      const h = (await hold(app, MON_0900)).json();
      const done = await complete(app, h.token, { email: undefined });
      await flush();
      expect(done.statusCode).toBe(200);
      expect(email.outbox).toHaveLength(0);
    });
  });

  it('si el proveedor de correo falla, la reserva sigue y el fallo queda registrado', async () => {
    await withApp(async ({ app, email, q, flush }) => {
      email.failNext = true;
      const h = (await hold(app, MON_0900)).json();
      const done = await complete(app, h.token);
      await flush();
      expect(done.json().status).toBe('pending');
      const [log] = await q`select status, error from message_log where booking_id = ${done.json().bookingId}`;
      expect(log).toEqual({ status: 'failed', error: 'simulated provider failure' });
    });
  });

  it('asigna otro profesional libre cuando el cliente eligió "cualquiera"', async () => {
    await withApp(async ({ app }) => {
      const first = await hold(app, TUE_1400);
      const second = await hold(app, TUE_1400);
      const third = await hold(app, TUE_1400);
      expect(first.json().resourceId).toBe(DRA);
      expect(second.json().resourceId).toBe(LIC);
      expect(third.json()).toEqual({ error: 'slot_unavailable' });
    });
  });

  it('respeta el profesional elegido', async () => {
    await withApp(async ({ app }) => {
      const res = await hold(app, TUE_1400, { resourceId: LIC });
      expect(res.json().resourceId).toBe(LIC);
      const res2 = await hold(app, TUE_1400, { resourceId: LIC });
      expect(res2.json()).toEqual({ error: 'slot_unavailable' });
    });
  });
});

describe('reglas del horario (R-04, R-09)', () => {
  it('una retención vencida no se puede completar y libera el horario', async () => {
    await withApp(async ({ app, advance }) => {
      const h = (await hold(app, MON_0900)).json();
      advance(10);
      const late = await complete(app, h.token);
      expect(late.statusCode).toBe(410);
      expect(late.json()).toEqual({ error: 'hold_expired' });
      expect(await availableStarts(app, '2026-10-19')).toContain(MON_0900);
      expect((await complete(app, h.token)).json()).toEqual({ error: 'hold_invalid' });
    });
  });

  it('otra persona puede tomar un horario cuya retención venció', async () => {
    await withApp(async ({ app, advance }) => {
      await hold(app, MON_0900, { resourceId: DRA });
      advance(11);
      const res = await hold(app, MON_0900, { resourceId: DRA });
      expect(res.statusCode).toBe(201);
    });
  });

  it.each([
    ['fuera del horario', '2026-10-19T13:00:00.000Z'],
    ['fuera de la grilla', '2026-10-19T14:10:00.000Z'],
    ['en domingo', '2026-10-25T14:00:00.000Z'],
    ['más allá de la anticipación máxima', '2026-12-07T14:00:00.000Z'],
  ])('no retiene un horario %s', async (_, start) => {
    await withApp(async ({ app }) => {
      expect((await hold(app, start)).json()).toEqual({ error: 'slot_unavailable' });
    });
  });

  it('no retiene dentro de la anticipación mínima (2 h)', async () => {
    await withApp(async ({ app, clock }) => {
      clock.now = new Date('2026-10-19T13:30:00Z'); // lunes 08:30
      expect((await hold(app, MON_1000)).json()).toEqual({ error: 'slot_unavailable' });
      expect((await hold(app, '2026-10-19T15:30:00.000Z')).statusCode).toBe(201);
    });
  });
});

describe('validación de datos del cliente', () => {
  it.each([
    [{ phone: '02 298 4500' }, 422, 'phone_not_mobile'],
    [{ phone: '12345678' }, 422, 'phone_invalid'],
    [{ consent: false }, 400, 'invalid_request'],
    [{ consentVersion: '2020-01-v0' }, 409, 'consent_outdated'],
    [{ website: 'http://spam' }, 400, 'invalid_request'],
    [{ email: 'no-es-correo' }, 400, 'invalid_request'],
    [{ name: 'A' }, 400, 'invalid_request'],
  ])('%j → %i %s', async (extra, status, error) => {
    await withApp(async ({ app }) => {
      const h = (await hold(app, MON_0900)).json();
      const res = await complete(app, h.token, extra);
      expect(res.statusCode).toBe(status);
      expect(res.json().error).toBe(error);
    });
  });

  it('un token inexistente es 404 y uno malformado 400', async () => {
    await withApp(async ({ app }) => {
      expect((await complete(app, 'A'.repeat(43))).json()).toEqual({ error: 'booking_not_found' });
      expect((await complete(app, 'corto')).statusCode).toBe(400);
    });
  });

  it('un local de otro negocio no sirve para reservar aquí', async () => {
    await withApp(async ({ app, q }) => {
      const [acc] = await q`insert into account (name) values ('Otro') returning id`;
      const [biz] = await q`insert into business (account_id, slug, name, vertical) values (${acc!.id}, 'otro', 'Otro', 'appointments') returning id`;
      const [loc] = await q`insert into location (business_id, name, timezone) values (${biz!.id}, 'X', 'America/Guayaquil') returning id`;
      const res = await hold(app, MON_0900, { locationId: loc!.id });
      expect(res.json()).toEqual({ error: 'location_not_found' });
    });
  });
});

describe('gestionar la cita sin cuenta (HU-06)', () => {
  it('muestra la cita sin exponer datos de contacto', async () => {
    await withApp(async ({ app }) => {
      const token = await book(app, MON_0900);
      const res = await app.inject(`/v1/manage/${token}`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        status: 'pending',
        start: MON_0900,
        customerName: 'Sofía Benítez',
        business: { slug: SLUG },
        resource: { id: DRA, name: 'Dra. Valeria Paredes' },
        canCancel: true,
        canReschedule: true,
      });
      expect(res.body).not.toMatch(/593|sofia@|phone|email/);
    });
  });

  it('una retención sin completar no se puede gestionar', async () => {
    await withApp(async ({ app }) => {
      const h = (await hold(app, MON_0900)).json();
      expect((await app.inject(`/v1/manage/${h.token}`)).statusCode).toBe(404);
      expect((await app.inject({ method: 'POST', url: `/v1/manage/${h.token}/cancel` })).statusCode).toBe(404);
    });
  });

  it('cancelar libera el horario y no se puede repetir', async () => {
    await withApp(async ({ app }) => {
      const token = await book(app, MON_0900);
      const res = await app.inject({ method: 'POST', url: `/v1/manage/${token}/cancel` });
      expect(res.json()).toMatchObject({ status: 'cancelled' });
      expect(await availableStarts(app, '2026-10-19')).toContain(MON_0900);

      const again = await app.inject({ method: 'POST', url: `/v1/manage/${token}/cancel` });
      expect(again.json()).toEqual({ error: 'booking_closed' });
      expect((await app.inject(`/v1/manage/${token}`)).json()).toMatchObject({ status: 'cancelled', canCancel: false });
    });
  });

  it('no se cancela una cita que ya empezó', async () => {
    await withApp(async ({ app, clock }) => {
      const token = await book(app, MON_0900);
      clock.now = new Date('2026-10-19T14:05:00Z');
      const res = await app.inject({ method: 'POST', url: `/v1/manage/${token}/cancel` });
      expect(res.json()).toEqual({ error: 'booking_started' });
    });
  });

  it('reprogramar mueve la cita, enlaza las dos y entrega un enlace nuevo', async () => {
    await withApp(async ({ app, q, email, flush }) => {
      const token = await book(app, MON_0900);
      await flush();

      // 09:30 se solapa con la ocupación actual (09:00–10:00): solo es posible porque la
      // cita vieja se libera primero, dentro de la misma transacción.
      const res = await app.inject({ method: 'POST', url: `/v1/manage/${token}/reschedule`, payload: { start: MON_0930 } });
      expect(res.statusCode).toBe(200);
      const moved = res.json();
      expect(moved).toMatchObject({ status: 'pending', start: MON_0930, resourceId: DRA });
      expect(moved).not.toHaveProperty('token');
      await flush();

      const newToken = tokenFrom(moved.manageUrl);
      expect(newToken).not.toBe(token);
      expect((await app.inject(`/v1/manage/${token}`)).json()).toMatchObject({ status: 'rescheduled', canReschedule: false });
      expect((await app.inject(`/v1/manage/${newToken}`)).json()).toMatchObject({ status: 'pending', start: MON_0930 });

      const [link] = await q`
        select old.replaced_by_id = new.id as linked, old.customer_id = new.customer_id as same_customer
        from booking old join booking new on new.id = ${moved.id}
        where old.replaced_by_id is not null and old.status = 'rescheduled'`;
      expect(link).toEqual({ linked: true, same_customer: true });

      expect(email.outbox).toHaveLength(2);
      expect(email.outbox[1]!.text).toContain('09:30');

      const reuse = await app.inject({ method: 'POST', url: `/v1/manage/${token}/reschedule`, payload: { start: MON_1000 } });
      expect(reuse.json()).toEqual({ error: 'booking_closed' });
    });
  });

  it('si el horario nuevo no está disponible, la cita original queda intacta', async () => {
    await withApp(async ({ app }) => {
      const token = await book(app, MON_0900);
      await book(app, MON_1000);
      const res = await app.inject({ method: 'POST', url: `/v1/manage/${token}/reschedule`, payload: { start: MON_1000 } });
      expect(res.json()).toEqual({ error: 'slot_unavailable' });
      expect((await app.inject(`/v1/manage/${token}`)).json()).toMatchObject({ status: 'pending', start: MON_0900 });
    });
  });
});

describe('protecciones de la API', () => {
  it('CORS solo para nuestra propia web', async () => {
    await withApp(async ({ app }) => {
      const allowed = await app.inject({
        method: 'OPTIONS', url: `/v1/public/${SLUG}`,
        headers: { origin: WEB, 'access-control-request-method': 'GET' },
      });
      expect(allowed.headers['access-control-allow-origin']).toBe(WEB);
      const denied = await app.inject({
        method: 'OPTIONS', url: `/v1/public/${SLUG}`,
        headers: { origin: 'https://otro-sitio.test', 'access-control-request-method': 'GET' },
      });
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  it('limita las retenciones por IP', async () => {
    await withApp(async ({ app }) => {
      const codes: number[] = [];
      for (let i = 0; i < 22; i++) codes.push((await hold(app, '2026-10-19T13:00:00.000Z')).statusCode);
      expect(codes.slice(0, 20).every((c) => c === 409)).toBe(true);
      expect(codes.slice(20)).toEqual([429, 429]);
    });
  });

  it('los tokens nunca llegan a los logs (P7)', () => {
    expect(maskUrl('/v1/manage/abcDEF_123-xyz/cancel')).toBe('/v1/manage/***/cancel');
    expect(maskUrl('/v1/public/aura-estetica')).toBe('/v1/public/aura-estetica');
  });
});

describe('carrera real por el mismo horario (conexiones concurrentes)', () => {
  it('de dos retenciones simultáneas, gana exactamente una', async () => {
    const db = createDb(DATABASE_URL);
    const app = buildApp({ db, email: new MemoryEmailSender(), now: () => SUNDAY_EVENING, corsOrigins: [WEB], publicWebUrl: WEB });
    const start = '2026-10-21T14:00:00.000Z';
    try {
      const results = await Promise.all(
        Array.from({ length: 6 }, () => hold(app, start, { resourceId: DRA })),
      );
      const codes = results.map((r) => r.statusCode).sort();
      expect(codes.filter((c) => c === 201)).toHaveLength(1);
      expect(codes.filter((c) => c === 409)).toHaveLength(5);
      for (const r of results.filter((x) => x.statusCode === 409)) {
        expect(['slot_taken', 'slot_unavailable']).toContain(r.json().error);
      }
    } finally {
      await sql`
        delete from booking where location_id = ${LOCATION} and lower(span) = ${start}::timestamptz`;
      await app.close();
      await db.close();
    }
  });
});

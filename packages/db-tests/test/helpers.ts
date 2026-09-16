import { createHash, randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';

export const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', {
  max: 1,
  onnotice: () => {},
});

export type Tx = postgres.TransactionSql;

class Rollback extends Error {}

/** Runs `fn` in a transaction that is always rolled back, so tests never leave data behind. */
export async function inTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await sql.begin(async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

/** Simulates a panel user whose JWT carries these businesses (P1). */
export async function asPanelUser(tx: Tx, businessIds: string[]): Promise<void> {
  const claims = JSON.stringify({ role: 'authenticated', app_metadata: { business_ids: businessIds } });
  await tx`select set_config('request.jwt.claims', ${claims}, true)`;
  await tx`set local role authenticated`;
}

export async function asAnon(tx: Tx): Promise<void> {
  await tx`select set_config('request.jwt.claims', '{"role":"anon"}', true)`;
  await tx`set local role anon`;
}

export async function asSuperuser(tx: Tx): Promise<void> {
  await tx`reset role`;
}

/** Runs `fn` in a savepoint and returns the Postgres error code it failed with, or null. */
export async function errorCode(tx: Tx, fn: (sp: postgres.TransactionSql) => Promise<unknown>): Promise<string | null> {
  try {
    await tx.savepoint(async (sp) => {
      await fn(sp);
    });
    return null;
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    throw e;
  }
}

export const tokenHash = () => createHash('sha256').update(randomBytes(32)).digest();

export const range = (start: Date | string, end: Date | string) =>
  `[${new Date(start).toISOString()},${new Date(end).toISOString()})`;

export interface Tenant {
  businessId: string;
  locationId: string;
  resourceId: string;
  sharedResourceId: string;
  serviceId: string;
  customerId: string;
  bookingId: string;
  waAccountId: string;
  endpointId: string;
}

/** Creates a business with at least one row in every tenant table. */
export async function createTenant(tx: Tx, label: string): Promise<Tenant> {
  const u = () => randomUUID();
  const t: Tenant = {
    businessId: u(), locationId: u(), resourceId: u(), sharedResourceId: u(), serviceId: u(),
    customerId: u(), bookingId: u(), waAccountId: u(), endpointId: u(),
  };
  const accountId = u();
  const identityId = u();
  const phone = `+5939${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const [template] = await tx<{ id: string }[]>`
    insert into message_template (key, version, body, variant)
    values (${`test_${label}_${t.businessId}`}, 1, 'Hola {{1}}', 'a') returning id`;

  await tx`insert into account (id, name) values (${accountId}, ${label})`;
  await tx`insert into business (id, account_id, slug, name, vertical)
           values (${t.businessId}, ${accountId}, ${`t-${t.businessId}`}, ${label}, 'appointments')`;
  await tx`insert into location (id, business_id, name, timezone)
           values (${t.locationId}, ${t.businessId}, 'Matriz', 'America/Guayaquil')`;
  await tx`insert into resource (id, business_id, location_id, name)
           values (${t.resourceId}, ${t.businessId}, ${t.locationId}, 'Profesional')`;
  await tx`insert into resource (id, business_id, location_id, name, capacity)
           values (${t.sharedResourceId}, ${t.businessId}, ${t.locationId}, 'Sala grupal', 3)`;
  await tx`insert into service (id, business_id, location_id, name, duration_min, buffer_after_min)
           values (${t.serviceId}, ${t.businessId}, ${t.locationId}, 'Consulta', 30, 10)`;
  await tx`insert into service_resource (business_id, service_id, resource_id)
           values (${t.businessId}, ${t.serviceId}, ${t.resourceId})`;
  await tx`insert into availability_rule (business_id, location_id, weekday, starts_local, ends_local, slot_minutes)
           values (${t.businessId}, ${t.locationId}, 1, '09:00', '13:00', 30)`;
  await tx`insert into availability_exception (business_id, location_id, span)
           values (${t.businessId}, ${t.locationId}, ${range('2026-12-25T05:00Z', '2026-12-26T05:00Z')})`;
  await tx`insert into contact_identity (id, phone_e164) values (${identityId}, ${phone})`;
  await tx`insert into customer (id, business_id, identity_id, name)
           values (${t.customerId}, ${t.businessId}, ${identityId}, 'Cliente')`;
  await tx`insert into consent (business_id, identity_id, channel, exact_text, terms_version, source)
           values (${t.businessId}, ${identityId}, 'whatsapp',
                   'Acepto recibir confirmaciones y recordatorios de esta cita por WhatsApp', 'v1', 'widget')`;
  await tx`insert into booking (id, business_id, location_id, service_id, customer_id, status, span, public_token_hash)
           values (${t.bookingId}, ${t.businessId}, ${t.locationId}, ${t.serviceId}, ${t.customerId}, 'confirmed',
                   ${range('2026-10-19T14:00Z', '2026-10-19T14:30Z')}, ${tokenHash()})`;
  await tx`insert into booking_resource (business_id, booking_id, resource_id, span)
           values (${t.businessId}, ${t.bookingId}, ${t.resourceId}, ${range('2026-10-19T14:00Z', '2026-10-19T14:40Z')})`;
  await tx`insert into wa_account (id, business_id, status) values (${t.waAccountId}, ${t.businessId}, 'active')`;
  await tx`insert into wa_template_status (business_id, wa_account_id, template_id)
           values (${t.businessId}, ${t.waAccountId}, ${template!.id})`;
  await tx`insert into message_log (business_id, booking_id, identity_id, channel, kind, window_key, category, country, cost_estimate_micros, status)
           values (${t.businessId}, ${t.bookingId}, ${identityId}, 'whatsapp', 'confirmation', 'initial', 'UTILITY', 'EC', 0, 'sent')`;
  await tx`insert into webhook_endpoint (id, business_id, url, secret, events)
           values (${t.endpointId}, ${t.businessId}, 'https://example.com/hook', ${randomBytes(32).toString('hex')}, ${['booking.created']})`;
  await tx`insert into webhook_delivery (business_id, endpoint_id, event_id, event_type, payload)
           values (${t.businessId}, ${t.endpointId}, ${u()}, 'booking.created', '{}'::jsonb)`;
  return t;
}

export function first<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error('la consulta no devolvió filas');
  return row;
}

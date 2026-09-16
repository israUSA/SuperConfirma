import { DateTime } from 'luxon';
import { HOLD_MINUTES, generateSlots, normalizePhone, occupiedSpan, transition, type BookingStatus } from '@superconfirma/core';
import { findBusiness, findLocation, findService, loadAvailabilityQuery, type LocationRow } from './catalog.ts';
import { CONSENT } from './consent.ts';
import { EXCLUSION_VIOLATION, pgCode, type Db, type Q } from './db.ts';
import { ApiError, notFound } from './errors.ts';
import { hashToken, newToken } from './tokens.ts';

export type Source = 'widget' | 'page';

const range = (start: Date, end: Date) => `[${start.toISOString()},${end.toISOString()})`;

interface ReserveInput {
  businessId: string;
  location: LocationRow;
  serviceId: string;
  resourceId?: string | undefined;
  start: Date;
  now: Date;
  status: Extract<BookingStatus, 'hold' | 'pending'>;
  source: Source;
  customerId?: string;
}

interface Reserved {
  bookingId: string;
  token: string;
  resourceId: string;
  start: Date;
  end: Date;
  holdExpiresAt: Date | null;
}

/**
 * The engine decides what may be offered; Postgres decides who wins a race.
 * Candidates are tried in order, each in its own savepoint.
 */
async function reserve(q: Q, input: ReserveInput): Promise<Reserved> {
  await q`select app_private.expire_holds(${input.now})`;

  const localDate = DateTime.fromJSDate(input.start, { zone: input.location.timezone }).toISODate()!;
  const query = await loadAvailabilityQuery(q, {
    businessId: input.businessId,
    location: input.location,
    serviceId: input.serviceId,
    resourceId: input.resourceId,
    fromDate: localDate,
    toDate: localDate,
    now: input.now,
  });
  const candidates = generateSlots(query).filter((s) => s.start === input.start.getTime());
  if (candidates.length === 0) throw new ApiError(409, 'slot_unavailable');

  const service = await findService(q, input.businessId, input.location.id, input.serviceId);
  const holdExpiresAt = input.status === 'hold' ? new Date(input.now.getTime() + HOLD_MINUTES * 60_000) : null;

  for (const slot of candidates) {
    const token = newToken();
    const occupied = occupiedSpan(slot.start, (slot.end - slot.start) / 60_000, service.buffer_before_min, service.buffer_after_min);
    try {
      const bookingId = await q.savepoint(async (sp) => {
        const [booking] = await sp<{ id: string }[]>`
          insert into booking (business_id, location_id, service_id, customer_id, status, span,
                               source, hold_expires_at, public_token_hash)
          values (${input.businessId}, ${input.location.id}, ${input.serviceId}, ${input.customerId ?? null},
                  ${input.status}, ${range(new Date(slot.start), new Date(slot.end))},
                  ${input.source}, ${holdExpiresAt}, ${hashToken(token)})
          returning id`;
        await sp`
          insert into booking_resource (business_id, booking_id, resource_id, span)
          values (${input.businessId}, ${booking!.id}, ${slot.resourceId},
                  ${range(new Date(occupied.start), new Date(occupied.end))})`;
        return booking!.id;
      });
      return {
        bookingId,
        token,
        resourceId: slot.resourceId,
        start: new Date(slot.start),
        end: new Date(slot.end),
        holdExpiresAt,
      };
    } catch (e) {
      if (pgCode(e) !== EXCLUSION_VIOLATION) throw e;
    }
  }
  throw new ApiError(409, 'slot_taken');
}

export async function createHold(
  db: Db,
  now: Date,
  input: { slug: string; locationId: string; serviceId: string; resourceId?: string | undefined; start: Date; source: Source },
) {
  return db.tx(async (q) => {
    const business = await findBusiness(q, input.slug);
    const location = await findLocation(q, business.id, input.locationId);
    const held = await reserve(q, { ...input, businessId: business.id, location, now, status: 'hold' });
    return {
      token: held.token,
      resourceId: held.resourceId,
      start: held.start.toISOString(),
      end: held.end.toISOString(),
      holdExpiresAt: held.holdExpiresAt!.toISOString(),
      consent: CONSENT,
    };
  });
}

interface TokenBooking {
  id: string;
  business_id: string;
  location_id: string;
  service_id: string | null;
  customer_id: string | null;
  status: BookingStatus;
  starts_at: Date;
  ends_at: Date;
  hold_expires_at: Date | null;
}

async function bookingByToken(q: Q, token: string): Promise<TokenBooking> {
  const [row] = await q<TokenBooking[]>`
    select id, business_id, location_id, service_id, customer_id, status,
           lower(span) as starts_at, upper(span) as ends_at, hold_expires_at
    from booking where public_token_hash = ${hashToken(token)}
    for update`;
  if (!row) throw notFound('booking');
  return row;
}

export interface CompleteInput {
  token: string;
  name: string;
  phone: string;
  email?: string | undefined;
  consentVersion: string;
  source: Source;
  ip: string | null;
}

export async function completeHold(db: Db, now: Date, input: CompleteInput) {
  if (input.consentVersion !== CONSENT.version) throw new ApiError(409, 'consent_outdated', { current: CONSENT });

  const phone = normalizePhone(input.phone);
  if (!phone.ok) throw new ApiError(422, phone.reason === 'not_mobile' ? 'phone_not_mobile' : 'phone_invalid');

  const result = await db.tx(async (q) => {
    const booking = await bookingByToken(q, input.token);

    if (booking.status !== 'hold') {
      if (booking.customer_id && booking.status !== 'cancelled') {
        return { bookingId: booking.id, status: booking.status, alreadyCompleted: true };
      }
      throw new ApiError(409, 'hold_invalid');
    }

    const submitted = transition(
      { status: booking.status, startsAt: booking.starts_at.getTime(), holdExpiresAt: booking.hold_expires_at?.getTime() ?? null },
      'submit',
      now.getTime(),
    );
    if (!submitted.ok) {
      if (submitted.reason === 'hold_expired') {
        // Committed on purpose: the slot is released even though the request fails.
        await q`update booking set status = 'cancelled', cancelled_by = 'system', cancelled_at = ${now} where id = ${booking.id}`;
        return null;
      }
      throw new ApiError(409, 'hold_invalid');
    }

    const [identity] = await q<{ id: string }[]>`
      insert into contact_identity (phone_e164) values (${phone.e164})
      on conflict (phone_e164) do update set phone_e164 = excluded.phone_e164
      returning id`;
    const [customer] = await q<{ id: string }[]>`
      insert into customer (business_id, identity_id, name, email)
      values (${booking.business_id}, ${identity!.id}, ${input.name}, ${input.email ?? null})
      on conflict (business_id, identity_id)
      do update set name = excluded.name, email = coalesce(excluded.email, customer.email)
      returning id`;
    await q`
      insert into consent (business_id, identity_id, channel, exact_text, terms_version, source, source_ip)
      values (${booking.business_id}, ${identity!.id}, ${CONSENT.channel}, ${CONSENT.text},
              ${CONSENT.version}, ${input.source}, ${input.ip})`;
    await q`
      update booking set status = ${submitted.status}, customer_id = ${customer!.id}, hold_expires_at = null
      where id = ${booking.id}`;

    return { bookingId: booking.id, status: submitted.status, alreadyCompleted: false };
  });
  if (!result) throw new ApiError(410, 'hold_expired');
  return result;
}

export async function getManaged(db: Db, now: Date, token: string) {
  return db.tx(async (q) => {
    const [row] = await q<
      {
        id: string; status: BookingStatus; starts_at: Date; ends_at: Date;
        business_name: string; business_slug: string; location_id: string; location_name: string;
        address: string | null; timezone: string; service_id: string | null; service_name: string | null;
        resource_id: string | null; resource_name: string | null; customer_name: string | null;
      }[]
    >`
      select b.id, b.status, lower(b.span) as starts_at, upper(b.span) as ends_at,
             bz.name as business_name, bz.slug as business_slug,
             l.id as location_id, l.name as location_name, l.address, l.timezone,
             s.id as service_id, s.name as service_name,
             r.id as resource_id, r.name as resource_name, c.name as customer_name
      from booking b
      join business bz on bz.id = b.business_id
      join location l on l.id = b.location_id
      left join service s on s.id = b.service_id
      left join customer c on c.id = b.customer_id
      left join lateral (
        select r.id, r.name from booking_resource br join resource r on r.id = br.resource_id
        where br.booking_id = b.id order by r.sort_order limit 1
      ) r on true
      where b.public_token_hash = ${hashToken(token)} and b.status <> 'hold'`;
    if (!row) throw notFound('booking');

    const changeable = ['pending', 'confirmed', 'unconfirmed'].includes(row.status) && row.starts_at > now;
    return {
      id: row.id,
      status: row.status,
      start: row.starts_at.toISOString(),
      end: row.ends_at.toISOString(),
      customerName: row.customer_name,
      business: { name: row.business_name, slug: row.business_slug },
      location: { id: row.location_id, name: row.location_name, address: row.address, timezone: row.timezone },
      service: row.service_id ? { id: row.service_id, name: row.service_name } : null,
      resource: row.resource_id ? { id: row.resource_id, name: row.resource_name } : null,
      canCancel: changeable,
      canReschedule: changeable,
    };
  });
}

async function changeableBooking(q: Q, now: Date, token: string): Promise<TokenBooking> {
  const booking = await bookingByToken(q, token);
  if (booking.status === 'hold') throw notFound('booking');
  if (!['pending', 'confirmed', 'unconfirmed'].includes(booking.status)) throw new ApiError(409, 'booking_closed');
  if (booking.starts_at <= now) throw new ApiError(409, 'booking_started');
  return booking;
}

export async function cancelManaged(db: Db, now: Date, token: string) {
  return db.tx(async (q) => {
    const booking = await changeableBooking(q, now, token);
    await q`
      update booking set status = 'cancelled', cancelled_by = 'customer', cancelled_at = ${now}
      where id = ${booking.id}`;
    return { id: booking.id, status: 'cancelled' as const };
  });
}

export async function rescheduleManaged(
  db: Db,
  now: Date,
  token: string,
  input: { start: Date; resourceId?: string | undefined },
) {
  return db.tx(async (q) => {
    const old = await changeableBooking(q, now, token);
    if (!old.service_id) throw new ApiError(409, 'booking_not_reschedulable');

    // Free the old time first, so moving within an overlapping window is possible.
    await q`update booking set status = 'rescheduled' where id = ${old.id}`;

    const [location] = await q<LocationRow[]>`
      select id, name, timezone, address, phone_country, min_advance_min, max_advance_days
      from location where id = ${old.location_id}`;
    const created = await reserve(q, {
      businessId: old.business_id,
      location: location!,
      serviceId: old.service_id,
      resourceId: input.resourceId,
      start: input.start,
      now,
      status: 'pending',
      source: 'page',
      ...(old.customer_id ? { customerId: old.customer_id } : {}),
    });
    await q`update booking set replaced_by_id = ${created.bookingId} where id = ${old.id}`;

    return {
      id: created.bookingId,
      token: created.token,
      status: 'pending' as const,
      start: created.start.toISOString(),
      end: created.end.toISOString(),
      resourceId: created.resourceId,
    };
  });
}

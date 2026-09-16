import { DateTime } from 'luxon';
import type {
  AvailabilityException,
  AvailabilityQuery,
  AvailabilityRule,
  Busy,
  Weekday,
} from '@superconfirma/core';
import type { Q } from './db.ts';
import { ApiError, notFound } from './errors.ts';

export interface BusinessRef {
  id: string;
  slug: string;
  name: string;
}

export async function findBusiness(q: Q, slug: string): Promise<BusinessRef> {
  const [row] = await q<BusinessRef[]>`select id, slug, name from business where slug = ${slug}`;
  if (!row) throw notFound('business');
  return row;
}

export interface LocationRow {
  id: string;
  name: string;
  timezone: string;
  address: string | null;
  phone_country: string;
  min_advance_min: number;
  max_advance_days: number;
}

export async function findLocation(q: Q, businessId: string, locationId: string): Promise<LocationRow> {
  const [row] = await q<LocationRow[]>`
    select id, name, timezone, address, phone_country, min_advance_min, max_advance_days
    from location where id = ${locationId} and business_id = ${businessId}`;
  if (!row) throw notFound('location');
  return row;
}

export async function publicCatalog(q: Q, business: BusinessRef) {
  const locations = await q<LocationRow[]>`
    select id, name, timezone, address, phone_country, min_advance_min, max_advance_days
    from location where business_id = ${business.id} order by created_at`;
  const services = await q<
    { id: string; location_id: string; name: string; duration_min: number; price_cents: number | null; resource_ids: string[] }[]
  >`
    select s.id, s.location_id, s.name, s.duration_min, s.price_cents,
           coalesce(array_agg(sr.resource_id order by r.sort_order) filter (where r.id is not null), '{}') as resource_ids
    from service s
    left join service_resource sr on sr.service_id = s.id
    left join resource r on r.id = sr.resource_id and r.active
    where s.business_id = ${business.id} and s.active
    group by s.id
    order by s.name`;
  const resources = await q<{ id: string; location_id: string; name: string }[]>`
    select id, location_id, name from resource
    where business_id = ${business.id} and active
    order by sort_order, name`;

  return {
    business: { slug: business.slug, name: business.name },
    locations: locations.map((l) => ({
      id: l.id,
      name: l.name,
      timezone: l.timezone,
      address: l.address,
      bookingWindow: { minAdvanceMin: l.min_advance_min, maxAdvanceDays: l.max_advance_days },
    })),
    services: services.map((s) => ({
      id: s.id,
      locationId: s.location_id,
      name: s.name,
      durationMin: s.duration_min,
      priceCents: s.price_cents,
      resourceIds: s.resource_ids,
    })),
    resources: resources.map((r) => ({ id: r.id, locationId: r.location_id, name: r.name })),
  };
}

export interface AvailabilityRequest {
  businessId: string;
  location: LocationRow;
  serviceId: string;
  resourceId?: string | undefined;
  fromDate: string;
  toDate: string;
  now: Date;
}

export interface ServiceRow {
  id: string;
  name: string;
  duration_min: number;
  buffer_before_min: number;
  buffer_after_min: number;
  sensitive: boolean;
}

export async function findService(q: Q, businessId: string, locationId: string, serviceId: string): Promise<ServiceRow> {
  const [row] = await q<ServiceRow[]>`
    select id, name, duration_min, buffer_before_min, buffer_after_min, sensitive
    from service
    where id = ${serviceId} and business_id = ${businessId} and location_id = ${locationId} and active`;
  if (!row) throw notFound('service');
  return row;
}

/** Everything the pure engine needs, read inside the caller's transaction. */
export async function loadAvailabilityQuery(q: Q, req: AvailabilityRequest): Promise<AvailabilityQuery> {
  const { location } = req;
  const service = await findService(q, req.businessId, location.id, req.serviceId);

  const first = DateTime.fromISO(req.fromDate, { zone: location.timezone });
  const last = DateTime.fromISO(req.toDate, { zone: location.timezone });
  if (!first.isValid || !last.isValid || last < first) throw new ApiError(400, 'invalid_date_range');
  if (last.diff(first, 'days').days > 31) throw new ApiError(400, 'date_range_too_long');

  // One extra day on each side covers buffers that cross midnight.
  const windowStart = first.minus({ days: 1 }).toJSDate();
  const windowEnd = last.plus({ days: 2 }).toJSDate();

  const resources = await q<{ resource_id: string; duration_override_min: number | null }[]>`
    select sr.resource_id, sr.duration_override_min
    from service_resource sr join resource r on r.id = sr.resource_id
    where sr.service_id = ${service.id} and r.active and r.location_id = ${location.id}
    order by r.sort_order, r.name`;
  if (req.resourceId && !resources.some((r) => r.resource_id === req.resourceId)) {
    throw notFound('resource');
  }

  const rules = await q<
    { resource_id: string | null; weekday: number; starts_local: string; ends_local: string; slot_minutes: number; valid_from: string | null; valid_until: string | null }[]
  >`
    select resource_id, weekday, starts_local::text, ends_local::text, slot_minutes,
           valid_from::text, valid_until::text
    from availability_rule
    where location_id = ${location.id} and business_id = ${req.businessId} and mode = 'slot'`;

  const exceptions = await q<{ resource_id: string | null; kind: 'block' | 'open'; s: Date; e: Date }[]>`
    select resource_id, kind, lower(span) as s, upper(span) as e
    from availability_exception
    where location_id = ${location.id} and business_id = ${req.businessId}
      and span && tstzrange(${windowStart}, ${windowEnd})`;

  const busy = await q<{ resource_id: string; s: Date; e: Date }[]>`
    select br.resource_id, lower(br.span) as s, upper(br.span) as e
    from booking_resource br
    where br.business_id = ${req.businessId} and br.blocking
      and br.resource_id = any(${resources.map((r) => r.resource_id)}::uuid[])
      and br.span && tstzrange(${windowStart}, ${windowEnd})`;

  return {
    timezone: location.timezone,
    fromDate: req.fromDate,
    toDate: req.toDate,
    now: req.now.getTime(),
    window: { minAdvanceMin: location.min_advance_min, maxAdvanceDays: location.max_advance_days },
    service: {
      durationMin: service.duration_min,
      bufferBeforeMin: service.buffer_before_min,
      bufferAfterMin: service.buffer_after_min,
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
    ...(req.resourceId ? { resourceId: req.resourceId } : {}),
  };
}

-- M0 · Esquema inicial de SuperConfirma
-- Invariantes en la base (P2), aislamiento por negocio (P1), tiempo con zona (P9).

create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Funciones internas: no expuestas por la API de datos ni ejecutables por el panel.
create schema app_private;
revoke all on schema app_private from public;
alter default privileges in schema app_private revoke execute on functions from public, anon, authenticated;

-- ───────────────────────── Utilidades ─────────────────────────

create function app_private.is_valid_timezone(tz text) returns boolean
language plpgsql immutable as $$
begin
  if tz is null or tz !~ '^(UTC|[A-Za-z]+/[A-Za-z_-]+(/[A-Za-z_-]+)?)$' then
    return false;
  end if;
  perform now() at time zone tz;
  return true;
exception when invalid_parameter_value then
  return false;
end $$;

create function app_private.is_proper_span(s tstzrange) returns boolean
language sql immutable as $$
  select not isempty(s)
     and not lower_inf(s) and not upper_inf(s)
     and lower_inc(s) and not upper_inc(s)
$$;

-- Negocios del usuario del panel. Siempre un arreglo: una agencia opera varios (D-04).
create function app_private.jwt_business_ids() returns uuid[]
language sql stable as $$
  select coalesce(
    array(select jsonb_array_elements_text(auth.jwt() -> 'app_metadata' -> 'business_ids'))::uuid[],
    '{}'::uuid[]
  )
$$;

create function app_private.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ───────────────────────── Tenancy ─────────────────────────

create table public.account (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null default 'direct' check (kind in ('direct', 'agency')),
  created_at  timestamptz not null default now()
);

create table public.business (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.account (id),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name        text not null,
  -- Solo presentación y valores por defecto; el core nunca lo recibe (P13).
  vertical    text not null check (vertical in ('appointments', 'dining')),
  created_at  timestamptz not null default now()
);

create table public.location (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.business (id),
  name              text not null,
  timezone          text not null check (app_private.is_valid_timezone(timezone)),
  address           text,
  phone_country     text not null default 'EC' check (phone_country ~ '^[A-Z]{2}$'),
  min_advance_min   int  not null default 60 check (min_advance_min >= 0),
  max_advance_days  int  not null default 30 check (max_advance_days between 1 and 365),
  created_at        timestamptz not null default now(),
  unique (id, business_id)
);

-- ───────────────────────── Catálogo ─────────────────────────

create table public.resource (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null,
  location_id  uuid not null,
  name         text not null,
  capacity     int  not null default 1 check (capacity > 0),
  min_party    int  not null default 1 check (min_party > 0 and min_party <= capacity),
  active       boolean not null default true,
  sort_order   int  not null default 0,
  unique (id, business_id),
  foreign key (location_id, business_id) references public.location (id, business_id)
);

create table public.service (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null,
  location_id        uuid not null,
  name               text not null,
  duration_min       int  not null check (duration_min > 0),
  buffer_before_min  int  not null default 0 check (buffer_before_min >= 0),
  buffer_after_min   int  not null default 0 check (buffer_after_min >= 0),
  price_cents        int  check (price_cents >= 0),
  -- No se nombra en mensajes salientes salvo que el negocio lo habilite (P7).
  sensitive          boolean not null default true,
  active             boolean not null default true,
  unique (id, business_id),
  foreign key (location_id, business_id) references public.location (id, business_id)
);

create table public.service_resource (
  business_id            uuid not null,
  service_id             uuid not null,
  resource_id            uuid not null,
  duration_override_min  int check (duration_override_min > 0),
  primary key (service_id, resource_id),
  foreign key (service_id, business_id) references public.service (id, business_id) on delete cascade,
  foreign key (resource_id, business_id) references public.resource (id, business_id) on delete cascade
);

-- Horario recurrente en hora LOCAL del location (P9). weekday: 0 = domingo.
create table public.availability_rule (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null,
  location_id     uuid not null,
  resource_id     uuid,
  mode            text not null default 'slot' check (mode in ('slot', 'shift')),
  weekday         int  not null check (weekday between 0 and 6),
  starts_local    time not null,
  ends_local      time not null,
  slot_minutes    int  check (slot_minutes > 0),
  shift_name      text,
  shift_capacity  int  check (shift_capacity > 0),
  valid_from      date,
  valid_until     date,
  check (ends_local > starts_local),
  check (mode <> 'slot' or slot_minutes is not null),
  check (mode <> 'shift' or shift_capacity is not null),
  check (valid_until is null or valid_from is null or valid_until >= valid_from),
  foreign key (location_id, business_id) references public.location (id, business_id),
  foreign key (resource_id, business_id) references public.resource (id, business_id) on delete cascade
);

create table public.availability_exception (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null,
  location_id  uuid not null,
  resource_id  uuid,
  span         tstzrange not null check (app_private.is_proper_span(span)),
  kind         text not null default 'block' check (kind in ('block', 'open')),
  reason       text,
  foreign key (location_id, business_id) references public.location (id, business_id),
  foreign key (resource_id, business_id) references public.resource (id, business_id) on delete cascade
);

-- ───────────────────────── Personas ─────────────────────────

-- GLOBAL: la única tabla de datos sin business_id. Solo accesible con service_role.
create table public.contact_identity (
  id            uuid primary key default gen_random_uuid(),
  phone_e164    text not null unique check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  phone_hash    text,
  opted_out_at  timestamptz,  -- baja GLOBAL (R-07)
  created_at    timestamptz not null default now()
);

create table public.customer (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.business (id),
  identity_id  uuid not null references public.contact_identity (id),
  name         text not null,
  email        text,
  notes        text,
  created_at   timestamptz not null default now(),
  unique (business_id, identity_id),
  unique (id, business_id)
);

create table public.consent (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.business (id),
  identity_id    uuid not null references public.contact_identity (id),
  channel        text not null check (channel in ('whatsapp', 'email', 'sms')),
  exact_text     text not null check (length(exact_text) > 0),
  terms_version  text not null,
  source         text not null check (source in ('widget', 'page', 'manual', 'api', 'whatsapp')),
  source_ip      inet,
  granted_at     timestamptz not null default now(),
  revoked_at     timestamptz
);

-- ───────────────────────── Reservas ─────────────────────────

create type public.booking_status as enum (
  'hold', 'pending', 'confirmed', 'unconfirmed',
  'arrived', 'completed', 'cancelled', 'no_show', 'rescheduled'
);

-- Debe coincidir con isBlocking() de packages/core (test de paridad).
create function app_private.booking_status_blocks(s public.booking_status) returns boolean
language sql immutable as $$
  select s in ('hold', 'pending', 'confirmed', 'unconfirmed', 'arrived', 'completed')
$$;

-- Debe coincidir con canTransition() de packages/core (test de paridad).
create function app_private.booking_transition_allowed(from_s public.booking_status, to_s public.booking_status)
returns boolean language sql immutable as $$
  select (from_s, to_s) in (
    ('hold', 'pending'), ('hold', 'cancelled'),
    ('pending', 'confirmed'), ('pending', 'unconfirmed'), ('pending', 'arrived'),
    ('pending', 'cancelled'), ('pending', 'no_show'), ('pending', 'rescheduled'),
    ('unconfirmed', 'confirmed'), ('unconfirmed', 'arrived'), ('unconfirmed', 'cancelled'),
    ('unconfirmed', 'no_show'), ('unconfirmed', 'rescheduled'),
    ('confirmed', 'arrived'), ('confirmed', 'cancelled'), ('confirmed', 'no_show'),
    ('confirmed', 'rescheduled'),
    ('arrived', 'completed')
  )
$$;

create table public.booking (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null,
  location_id        uuid not null,
  service_id         uuid,
  customer_id        uuid,
  status             public.booking_status not null default 'hold',
  span               tstzrange not null check (app_private.is_proper_span(span)),  -- lo que ve el cliente
  party_size         int  not null default 1 check (party_size > 0),
  source             text not null default 'widget' check (source in ('widget', 'page', 'manual', 'api', 'whatsapp')),
  hold_expires_at    timestamptz,
  confirmed_at       timestamptz,
  cancelled_at       timestamptz,
  cancelled_by       text check (cancelled_by in ('customer', 'staff', 'system')),
  replaced_by_id     uuid,
  -- El token de acceso sin cuenta (P11) nunca se guarda en claro: solo su sha256.
  public_token_hash  bytea not null unique check (length(public_token_hash) = 32),
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, business_id),
  check (status <> 'hold' or hold_expires_at is not null),
  foreign key (location_id, business_id) references public.location (id, business_id),
  foreign key (service_id, business_id) references public.service (id, business_id),
  foreign key (customer_id, business_id) references public.customer (id, business_id),
  foreign key (replaced_by_id, business_id) references public.booking (id, business_id)
);

create index booking_business_span_idx on public.booking using gist (business_id, span);
create index booking_hold_expiry_idx on public.booking (hold_expires_at) where status = 'hold';

create table public.booking_resource (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null,
  booking_id   uuid not null,
  resource_id  uuid not null,
  span         tstzrange not null check (app_private.is_proper_span(span)),  -- CON buffers (R-08)
  units        int  not null default 1 check (units > 0),
  -- Ambas las calcula el trigger; lo que mande la aplicación se ignora.
  blocking     boolean not null default true,
  exclusive    boolean not null default true,
  foreign key (booking_id, business_id) references public.booking (id, business_id) on delete cascade,
  foreign key (resource_id, business_id) references public.resource (id, business_id),

  -- R-01. Parcial: lo cancelado no bloquea (R-03). Capacidad N la cubre el trigger (R-02).
  constraint booking_resource_no_overlap
    exclude using gist (resource_id with =, span with &&) where (blocking and exclusive)
);

create index booking_resource_lookup_idx on public.booking_resource using gist (business_id, resource_id, span);
create index booking_resource_booking_idx on public.booking_resource (booking_id);

create function app_private.booking_resource_guard() returns trigger
language plpgsql as $$
declare
  v_status   public.booking_status;
  v_capacity int;
  v_peak     int;
begin
  -- Invisible por RLS o inexistente: para quien escribe, la reserva no existe.
  select status into v_status from public.booking where id = new.booking_id;
  if not found then
    raise exception 'booking % not found', new.booking_id using errcode = '23503';
  end if;
  new.blocking := app_private.booking_status_blocks(v_status);

  -- Serializa escrituras concurrentes sobre el mismo recurso.
  select capacity into v_capacity from public.resource where id = new.resource_id for update;
  if not found then
    raise exception 'resource % not found', new.resource_id using errcode = '23503';
  end if;
  new.exclusive := v_capacity = 1;

  if new.units > v_capacity then
    raise exception 'capacity_exceeded: % unidades en un recurso de capacidad %', new.units, v_capacity
      using errcode = '23P01';
  end if;

  if new.blocking and not new.exclusive then
    -- Ocupación máxima simultánea dentro del nuevo span: se mide en cada punto donde
    -- empieza una reserva, no sumando todo lo que toca (eso rechazaría casos válidos).
    select coalesce(max(occupied), 0) into v_peak
    from (
      select (
        select coalesce(sum(o.units), 0)
        from public.booking_resource o
        where o.resource_id = new.resource_id and o.blocking and o.id <> new.id and o.span @> p.at
      ) as occupied
      from (
        select lower(new.span) as at
        union
        select lower(o.span)
        from public.booking_resource o
        where o.resource_id = new.resource_id and o.blocking and o.id <> new.id
          and o.span && new.span and lower(o.span) > lower(new.span)
      ) p
    ) t;

    if v_peak + new.units > v_capacity then
      raise exception 'capacity_exceeded: ocupación % + % supera capacidad %', v_peak, new.units, v_capacity
        using errcode = '23P01';
    end if;
  end if;

  return new;
end $$;

create trigger booking_resource_guard
  before insert or update on public.booking_resource
  for each row execute function app_private.booking_resource_guard();

-- Bajar la capacidad a 1 debe someter las reservas existentes al EXCLUDE (y fallar si chocan).
create function app_private.resource_capacity_sync() returns trigger
language plpgsql as $$
begin
  update public.booking_resource set exclusive = exclusive where resource_id = new.id;
  return null;
end $$;

create trigger resource_capacity_sync
  after update of capacity on public.resource
  for each row when (old.capacity is distinct from new.capacity)
  execute function app_private.resource_capacity_sync();

create function app_private.booking_status_guard() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status
     and not app_private.booking_transition_allowed(old.status, new.status) then
    raise exception 'invalid_transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;
  if new.status = 'confirmed' and new.confirmed_at is null then
    new.confirmed_at := now();
  end if;
  if new.status = 'cancelled' and new.cancelled_at is null then
    new.cancelled_at := now();
  end if;
  return new;
end $$;

create trigger booking_status_guard
  before update of status on public.booking
  for each row execute function app_private.booking_status_guard();

create function app_private.booking_status_sync() returns trigger
language plpgsql as $$
begin
  -- El guard de booking_resource recalcula blocking a partir del estado nuevo.
  update public.booking_resource set blocking = blocking where booking_id = new.id;
  return null;
end $$;

create trigger booking_status_sync
  after update of status on public.booking
  for each row when (old.status is distinct from new.status)
  execute function app_private.booking_status_sync();

create trigger booking_touch
  before update on public.booking
  for each row execute function app_private.touch_updated_at();

-- R-04. La llama pg_cron cada minuto (M1) y la API antes de crear una retención.
create function app_private.expire_holds(p_now timestamptz default now()) returns int
language plpgsql as $$
declare
  n int;
begin
  update public.booking
     set status = 'cancelled', cancelled_at = p_now, cancelled_by = 'system'
   where status = 'hold' and hold_expires_at <= p_now;
  get diagnostics n = row_count;
  return n;
end $$;

-- ───────────────────────── Mensajería y costos ─────────────────────────

create table public.wa_account (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null unique references public.business (id),
  waba_id          text,
  phone_number_id  text,
  display_phone    text,
  status           text not null default 'disconnected'
                   check (status in ('disconnected', 'verifying', 'templates_pending', 'active', 'degraded')),
  quality_rating   text,
  connected_at     timestamptz,
  unique (id, business_id)
);

-- Plantilla maestra versionada, global. Se replica y aprueba por cada WABA.
create table public.message_template (
  id        uuid primary key default gen_random_uuid(),
  key       text not null,
  version   int  not null check (version > 0),
  locale    text not null default 'es',
  category  text not null default 'UTILITY' check (category in ('UTILITY', 'MARKETING', 'AUTHENTICATION')),
  body      text not null,
  buttons   jsonb,
  variant   text not null default 'a',
  unique (key, version, locale, variant)
);

create table public.wa_template_status (
  business_id      uuid not null,
  wa_account_id    uuid not null,
  template_id      uuid not null references public.message_template (id),
  remote_name      text,
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'paused')),
  rejected_reason  text,
  updated_at       timestamptz not null default now(),
  primary key (wa_account_id, template_id),
  foreign key (wa_account_id, business_id) references public.wa_account (id, business_id) on delete cascade
);

create table public.message_log (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references public.business (id),
  booking_id            uuid,
  identity_id           uuid references public.contact_identity (id),
  channel               text not null check (channel in ('whatsapp', 'email', 'sms')),
  template_key          text,
  kind                  text not null,
  window_key            text not null,
  category              text check (category in ('UTILITY', 'MARKETING', 'AUTHENTICATION', 'SERVICE')),
  country               text check (country ~ '^[A-Z]{2}$'),
  cost_estimate_micros  bigint check (cost_estimate_micros >= 0),
  provider_msg_id       text,
  status                text not null default 'queued'
                        check (status in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped')),
  error                 text,
  sent_at               timestamptz,
  created_at            timestamptz not null default now(),
  foreign key (booking_id, business_id) references public.booking (id, business_id),
  -- P5: nada sale sin costo y país registrados.
  check (status in ('queued', 'skipped') or (country is not null and cost_estimate_micros is not null)),
  check (channel <> 'whatsapp' or category is not null),
  -- R-05 / P3: el mismo mensaje no sale dos veces. La fila se inserta ANTES de enviar.
  constraint message_log_idempotency unique nulls not distinct (booking_id, kind, window_key)
);

create index message_log_business_month_idx on public.message_log (business_id, created_at);

-- ───────────────────────── Salida de datos ─────────────────────────

create table public.webhook_endpoint (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.business (id),
  url          text not null check (url ~ '^https://'),
  secret       text not null check (length(secret) >= 32),
  events       text[] not null check (
                 cardinality(events) > 0
                 and events <@ array[
                   'booking.created', 'booking.confirmed', 'booking.rescheduled',
                   'booking.cancelled', 'booking.no_show', 'booking.completed'
                 ]
               ),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (id, business_id)
);

create table public.webhook_delivery (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null,
  endpoint_id    uuid not null,
  event_id       uuid not null,  -- header webhook-id; idempotencia en el receptor
  event_type     text not null,
  payload        jsonb not null,
  attempt        int  not null default 0 check (attempt >= 0),
  status         text not null default 'pending' check (status in ('pending', 'delivered', 'failed', 'dead')),
  response_code  int,
  response_body  text,
  next_retry_at  timestamptz,
  created_at     timestamptz not null default now(),
  unique (endpoint_id, event_id),
  foreign key (endpoint_id, business_id) references public.webhook_endpoint (id, business_id) on delete cascade
);

create index webhook_delivery_due_idx on public.webhook_delivery (next_retry_at) where status in ('pending', 'failed');

-- ───────────────────────── Permisos y RLS (P1, P4) ─────────────────────────

-- El widget nunca toca la base (P4): anon no tiene nada.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- TRUNCATE se salta RLS: el panel no lo tiene nunca.
revoke truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;

-- Supabase concede EXECUTE por defecto; se revoca todo y se habilita solo lo que el panel
-- necesita al evaluar políticas, checks y triggers (funciones puras, sin efectos).
revoke all on all functions in schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated;
grant execute on function
  app_private.jwt_business_ids(),
  app_private.is_valid_timezone(text),
  app_private.is_proper_span(tstzrange),
  app_private.booking_status_blocks(public.booking_status),
  app_private.booking_transition_allowed(public.booking_status, public.booking_status)
to authenticated;

-- Tablas globales o de operación interna: solo service_role.
revoke all on public.account, public.contact_identity from authenticated;

-- El secreto de firma de webhooks no se lee desde el panel.
revoke select on public.webhook_endpoint from authenticated;
grant select (id, business_id, url, events, active, created_at) on public.webhook_endpoint to authenticated;

alter table public.account                enable row level security;
alter table public.business               enable row level security;
alter table public.location               enable row level security;
alter table public.resource               enable row level security;
alter table public.service                enable row level security;
alter table public.service_resource       enable row level security;
alter table public.availability_rule      enable row level security;
alter table public.availability_exception enable row level security;
alter table public.contact_identity       enable row level security;
alter table public.customer               enable row level security;
alter table public.consent                enable row level security;
alter table public.booking                enable row level security;
alter table public.booking_resource       enable row level security;
alter table public.wa_account             enable row level security;
alter table public.message_template       enable row level security;
alter table public.wa_template_status     enable row level security;
alter table public.message_log            enable row level security;
alter table public.webhook_endpoint       enable row level security;
alter table public.webhook_delivery       enable row level security;

-- `(select …)` hace que Postgres evalúe los claims una vez por consulta, no por fila.
create policy business_read on public.business
  for select to authenticated
  using (id = any ((select app_private.jwt_business_ids())::uuid[]));

do $$
declare
  t text;
begin
  -- El panel lee y escribe.
  foreach t in array array[
    'location', 'resource', 'service', 'service_resource', 'availability_rule',
    'availability_exception', 'customer', 'booking', 'booking_resource', 'webhook_endpoint'
  ] loop
    execute format(
      'create policy tenant_rw on public.%I for all to authenticated
         using (business_id = any ((select app_private.jwt_business_ids())::uuid[]))
         with check (business_id = any ((select app_private.jwt_business_ids())::uuid[]))', t);
  end loop;

  -- Lo escribe solo el sistema; el panel lee.
  foreach t in array array[
    'consent', 'wa_account', 'wa_template_status', 'message_log', 'webhook_delivery'
  ] loop
    execute format(
      'create policy tenant_read on public.%I for select to authenticated
         using (business_id = any ((select app_private.jwt_business_ids())::uuid[]))', t);
  end loop;
end $$;

create policy template_read on public.message_template
  for select to authenticated
  using (true);

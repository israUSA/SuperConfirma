-- M1 · Reserva pública

-- Sitios donde el negocio puede incrustar el widget (CSP frame-ancestors de la página embebida).
create function app_private.are_valid_origins(origins text[]) returns boolean
language sql immutable as $$
  select coalesce(bool_and(o ~ '^https?://[a-z0-9.-]+(:[0-9]{1,5})?$'), true)
  from unnest(origins) o
$$;

revoke all on function app_private.are_valid_origins(text[]) from public, anon, authenticated;
grant execute on function app_private.are_valid_origins(text[]) to authenticated;

alter table public.business
  add column allowed_origins text[] not null default '{}'
  check (app_private.are_valid_origins(allowed_origins));

-- R-04: las retenciones vencidas se liberan aunque nadie más intente reservar.
create extension if not exists pg_cron;

select cron.schedule('expire-holds', '* * * * *', $$select app_private.expire_holds()$$);

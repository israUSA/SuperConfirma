# Plan técnico · MVP de agendamiento y confirmación

_14 de septiembre de 2026 · calibrado para **20 h/semana** · un desarrollador_

Implementa [`spec.md`](spec.md) bajo [`../constitution.md`](../constitution.md).

---

## 1. La realidad del plazo

Antes de la investigación estimé "fase 1 en 4-6 semanas". Ese número asumía **un** rubro,
número de WhatsApp compartido y sin webhooks. Tus decisiones cambiaron las tres cosas.

| Hito | Entrega | Horas | Semanas |
|---|---|---|---|
| **M0** Cimientos | Esquema, RLS, motor de disponibilidad | 40 | 1–2 |
| **M1** Reserva pública | Página, widget y API funcionando | 80 | 3–6 |
| **M2** Panel | Configuración y operación diaria | 80 | 7–10 |
| **M3** WhatsApp | Confirmación automática completa | 100 | 11–15 |
| **M4** Salida y resultado | Webhooks, CSV, dinero recuperado | 60 | 16–18 |
| — Estabilización | Pulido con clientes reales | 40 | 19–20 |
| | | **400 h** | **~20 semanas** |

**≈ 4,5 meses.** Ese es el número honesto. No lo digo para que recortes: lo digo para que
el plan esté ordenado de forma que **empieces a cobrar en la semana 6, no en la 20**.

### Lo importante: M1 ya se vende

Al terminar M1 tienes un producto completo para tu negocio actual: *"tu landing page con
agenda propia"*. Reservas desde la web, confirmación por correo, panel mínimo. Eso ya se
empaqueta y se cobra mientras Meta aprueba los trámites y tú construyes M2 y M3.

Cada hito posterior es un upgrade que le subes de precio al mismo cliente, sin volver a
vender.

---

## 2. Ruta crítica: Meta. Empieza hoy, en paralelo

Esto **no consume tus 20 h semanales** pero bloquea M3. Arrancarlo en la semana 1 o en la
semana 10 es la diferencia entre entregar en el mes 4 o en el mes 6.

| # | Paso | Depende de | Calendario |
|---|---|---|---|
| 1 | Crear cuenta de **Meta Business** | — | 1 día |
| 2 | **Verificación de empresa**: RUC del SRI, documento de constitución, dirección, dominio verificado | Tener dominio propio y RUC | 1–15 días, puede rechazarse |
| 3 | Crear app en Meta for Developers con el producto WhatsApp | 1 | 1 día |
| 4 | **App Review** para acceso avanzado a `whatsapp_business_messaging` y `whatsapp_business_management` | 2, 3 | ~24 h promedio |
| 5 | **Access Verification** (paso aparte del App Review) | 4 | ~5 días hábiles |
| 6 | Alta como **Tech Provider** y configuración de Embedded Signup | 5 | días |
| 7 | Número de teléfono propio de pruebas (no puede estar en WhatsApp normal) | — | 1 día |

**Total realista: 2 a 6 semanas de calendario.** Los rechazos en el paso 2 son comunes y
reinician el reloj, así que el margen importa.

> ⚠️ **Embedded Signup v2 se deprecia el 8 de octubre de 2026.** Integrar directamente
> contra **v4**. No seguir tutoriales de v2 aunque sean los que más abundan.

### Tareas de esta semana, fuera del código

- [ ] Registrar el dominio definitivo (lo pide la verificación de empresa)
- [ ] Reunir RUC y documentos legales
- [ ] Crear cuenta de Meta Business y lanzar verificación
- [ ] Conseguir una línea telefónica dedicada para pruebas
- [ ] Verificar que la marca "SuperConfirma" esté libre en el SENADI

---

## 3. Decisiones técnicas

| # | Decisión | Alternativa descartada | Motivo |
|---|---|---|---|
| T-01 | Monorepo con workspaces de npm | Repos separados | Un solo desarrollador; el core se comparte entre API, workers y widget |
| T-02 | Supabase (Postgres 15+) | Postgres gestionado + NestJS puro | Auth, RLS, `pg_cron` y `pgmq` incluidos; debajo es Postgres estándar, migrable |
| T-03 | API propia en **Fastify + TypeScript** | NestJS | NestJS aporta estructura que un solo dev no necesita todavía; Fastify arranca más rápido y pesa menos en Edge |
| T-04 | Panel en **Angular + Tailwind** | — | Stack conocido (P: velocidad de quien lo escribe) |
| T-05 | Widget y página pública en **Astro + islas Preact** | Angular SSR | Página pública con SEO real y widget < 40 KB (RNF de la spec) |
| T-06 | Colas con **pgmq**, cron con **pg_cron** | Redis + BullMQ | Cero infraestructura extra; la escala del MVP no la justifica |
| T-07 | Validación con **Zod** compartida entre API y clientes | Validadores separados | Un solo esquema para API, widget y tipos de BD |
| T-08 | Migraciones SQL a mano, versionadas | ORM con migraciones automáticas | Las invariantes son constraints exóticas (`EXCLUDE USING gist`); ningún ORM las genera bien |
| T-09 | Consultas con `postgres.js` tipado, sin ORM | Prisma / Drizzle | El dominio es pequeño y las consultas de disponibilidad son SQL puro |
| T-10 | Embedded Signup **v4** | v2 | v2 se deprecia el 8-oct-2026 |

---

## 4. Esquema de datos

Núcleo único para ambos rubros (P13). SQL real, no pseudocódigo.

### Jerarquía y tenancy

```sql
create extension if not exists btree_gist;
create extension if not exists pg_cron;
create extension if not exists pgmq;

-- Quien paga. Puede ser una agencia con varios negocios (D-04).
create table account (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  kind         text not null default 'direct'  -- 'direct' | 'agency'
               check (kind in ('direct','agency')),
  created_at   timestamptz not null default now()
);

-- La marca que ve el cliente final. tenant_id de todo el sistema.
create table business (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references account(id),
  slug         text not null unique,
  name         text not null,
  vertical     text not null                    -- 'appointments' | 'dining'
               check (vertical in ('appointments','dining')),
  created_at   timestamptz not null default now()
);

-- Sucursal. Lleva la zona horaria y el número de WhatsApp.
create table location (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id),
  name          text not null,
  timezone      text not null,                  -- 'America/Guayaquil' | 'America/Galapagos'
  address       text,
  phone_country text not null default 'EC',
  created_at    timestamptz not null default now()
);
```

> `vertical` **solo afecta presentación y valores por defecto**, nunca la lógica del core
> (P13). El motor de disponibilidad no lo recibe como parámetro.

### Recursos, servicios y disponibilidad

```sql
-- Profesional (capacity 1) o mesa (capacity N). Misma tabla.
create table resource (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id),
  location_id   uuid not null references location(id),
  name          text not null,
  capacity      int  not null default 1 check (capacity > 0),
  min_party     int  not null default 1,        -- mesa de 4 que no se da a 1 persona
  active        boolean not null default true,
  sort_order    int not null default 0
);

create table service (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references business(id),
  location_id      uuid not null references location(id),
  name             text not null,
  duration_min     int  not null check (duration_min > 0),
  buffer_before_min int not null default 0,
  buffer_after_min  int not null default 0,
  price_cents      int,
  sensitive        boolean not null default false,  -- no nombrarlo en WhatsApp (P7)
  active           boolean not null default true
);

create table service_resource (
  service_id   uuid not null references service(id) on delete cascade,
  resource_id  uuid not null references resource(id) on delete cascade,
  duration_override_min int,
  primary key (service_id, resource_id)
);

-- Horario recurrente, expresado en hora LOCAL del location (P9).
create table availability_rule (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id),
  location_id   uuid not null references location(id),
  resource_id   uuid references resource(id),    -- null = aplica a todo el local
  mode          text not null                    -- 'slot' (cita) | 'shift' (turno)
                check (mode in ('slot','shift')),
  weekday       int  not null check (weekday between 0 and 6),
  starts_local  time not null,
  ends_local    time not null,
  slot_minutes  int,                             -- solo mode='slot'
  shift_name    text,                            -- solo mode='shift': "Almuerzo"
  shift_capacity int,                            -- cubiertos totales del turno
  valid_from    date,
  valid_until   date,
  check (ends_local > starts_local)
);

create table availability_exception (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references business(id),
  location_id  uuid not null references location(id),
  resource_id  uuid references resource(id),
  span         tstzrange not null,
  kind         text not null default 'block'     -- 'block' | 'open'
               check (kind in ('block','open')),
  reason       text
);
```

### Reservas — donde viven las invariantes

```sql
create type booking_status as enum (
  'hold','pending','confirmed','unconfirmed',
  'arrived','completed','cancelled','no_show','rescheduled'
);

create table booking (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references business(id),
  location_id    uuid not null references location(id),
  service_id     uuid references service(id),
  customer_id    uuid references customer(id),
  status         booking_status not null default 'hold',
  span           tstzrange not null,             -- visible para el cliente
  party_size     int not null default 1 check (party_size > 0),
  source         text not null default 'widget', -- 'widget'|'page'|'manual'|'api'|'whatsapp'
  hold_expires_at timestamptz,
  confirmed_at   timestamptz,
  cancelled_at   timestamptz,
  cancelled_by   text,                           -- 'customer'|'staff'|'system'
  replaced_by_id uuid references booking(id),
  public_token   text not null unique,           -- acceso sin cuenta (P11)
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Ocupación real del recurso. Incluye buffers. N:M para mesas unidas (v2).
create table booking_resource (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null,
  booking_id   uuid not null references booking(id) on delete cascade,
  resource_id  uuid not null references resource(id),
  span         tstzrange not null,               -- CON buffers incluidos (R-08)
  units        int not null default 1,
  blocking     boolean not null,                 -- derivado del status

  -- R-01: imposible solapar. Índice PARCIAL: las canceladas no bloquean.
  constraint booking_resource_no_overlap
    exclude using gist (resource_id with =, span with &&)
    where (blocking)
);

create index on booking_resource (business_id, resource_id, span);
```

**Cuatro detalles que deciden si esto funciona:**

1. `where (blocking)` — sin el índice parcial, una reserva cancelada bloquea el horario
   para siempre. Es el error más común con esta técnica.
2. Rangos `[)` siempre: `tstzrange(a, b, '[)')`. Permite 10:00–10:30 seguido de 10:30–11:00.
3. `booking.span` es lo que ve el cliente; `booking_resource.span` incluye los buffers.
4. `blocking` se mantiene con un trigger sobre `booking.status` — nunca desde la aplicación.

**Capacidad N (R-02)** no la cubre `EXCLUDE`. Se resuelve con un trigger que, dentro de la
transacción, bloquea la fila del recurso (`select ... for update`) y verifica que la suma de
`units` solapadas no supere `capacity`. Mismo mecanismo para el tope de cubiertos del turno.

### Clientes e identidad

```sql
create table customer (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references business(id),
  identity_id  uuid not null references contact_identity(id),
  name         text not null,
  email        text,
  notes        text,
  created_at   timestamptz not null default now(),
  unique (business_id, identity_id)
);

-- GLOBAL, transversal a todos los negocios. Base del futuro Confirm Score.
create table contact_identity (
  id           uuid primary key default gen_random_uuid(),
  phone_e164   text not null unique,             -- +5939XXXXXXXX
  phone_hash   text not null,                    -- sha256 con pepper
  opted_out_at timestamptz,                      -- baja GLOBAL (R-07)
  created_at   timestamptz not null default now()
);

create table consent (
  id            uuid primary key default gen_random_uuid(),
  identity_id   uuid not null references contact_identity(id),
  business_id   uuid not null references business(id),
  channel       text not null,                   -- 'whatsapp'|'email'|'sms'
  exact_text    text not null,                   -- el texto que realmente vio (P6)
  terms_version text not null,
  source_ip     inet,
  granted_at    timestamptz not null default now(),
  revoked_at    timestamptz
);
```

> `contact_identity` es **la única tabla sin `business_id`**, y por eso necesita RLS propia
> muy estricta: solo accesible desde la API con `service_role`, jamás desde el panel.

### Mensajería y costos

```sql
create table wa_account (                        -- un WABA por negocio (D-03)
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references business(id) unique,
  waba_id          text,
  phone_number_id  text,
  display_phone    text,
  status           text not null default 'disconnected',
   -- 'disconnected'|'verifying'|'templates_pending'|'active'|'degraded'
  quality_rating   text,
  connected_at     timestamptz
);

create table message_template (                  -- plantilla maestra versionada
  id           uuid primary key default gen_random_uuid(),
  key          text not null,                    -- 'reminder_24h'
  version      int not null,
  locale       text not null default 'es',
  category     text not null default 'UTILITY',
  body         text not null,
  buttons      jsonb,
  variant      text,                             -- para A/B futuro
  unique (key, version, locale, variant)
);

create table wa_template_status (                -- estado por WABA (¡no se comparten!)
  wa_account_id uuid not null references wa_account(id),
  template_id   uuid not null references message_template(id),
  remote_name   text,
  status        text not null default 'pending', -- 'pending'|'approved'|'rejected'
  rejected_reason text,
  updated_at    timestamptz not null default now(),
  primary key (wa_account_id, template_id)
);

create table message_log (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references business(id),
  booking_id       uuid references booking(id),
  identity_id      uuid references contact_identity(id),
  channel          text not null,
  template_key     text,
  kind             text not null,                -- 'confirmation'|'reminder_24h'|...
  window_key       text not null,                -- idempotencia (P3)
  category         text,                         -- UTILITY | SERVICE | MARKETING
  country          text,
  cost_estimate_micros bigint,                   -- metering desde el día 1 (P5)
  provider_msg_id  text,
  status           text not null default 'queued',
  error            text,
  sent_at          timestamptz,
  created_at       timestamptz not null default now(),

  -- R-05: el mismo mensaje no sale dos veces. Garantizado por la base.
  unique (booking_id, kind, window_key)
);
```

### Salida de datos

```sql
create table webhook_endpoint (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references business(id),
  url          text not null,
  secret       text not null,
  events       text[] not null,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table webhook_delivery (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null,
  endpoint_id  uuid not null references webhook_endpoint(id),
  event_id     uuid not null,                    -- webhook-id, clave de idempotencia
  event_type   text not null,
  payload      jsonb not null,
  attempt      int not null default 0,
  status       text not null default 'pending',  -- 'pending'|'delivered'|'failed'|'dead'
  response_code int,
  response_body text,
  next_retry_at timestamptz,
  created_at   timestamptz not null default now()
);
```

### RLS

Patrón único para toda tabla con `business_id` (P1, sin subqueries por fila):

```sql
alter table booking enable row level security;

create policy booking_tenant on booking
  for all
  using (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id')::uuid)
  with check (business_id = (auth.jwt() -> 'app_metadata' ->> 'business_id')::uuid);
```

El `business_id` entra al JWT con un Auth Hook al iniciar sesión. Para usuarios de agencia
con varios negocios, el claim es un arreglo y el operador es `= any(...)`.

---

## 5. Hitos

### M0 · Cimientos — semanas 1-2 · 40 h

*Nada visible. Es el hito que decide si el resto del proyecto duele o no.*

- Monorepo, TypeScript, lint, CI en GitHub Actions
- Proyecto Supabase, migraciones versionadas, todo el esquema anterior
- Triggers de `blocking` y de capacidad; seeds de un negocio de cada rubro
- **Suite de aislamiento entre negocios** — corre en CI y es requisito de merge
- **Tests de invariantes por SQL directo** — intentan violar R-01…R-05 saltándose la app
- `packages/core`: motor de disponibilidad (modos `slot` y `shift`) y máquina de estados,
  funciones puras con el tiempo inyectado

**Terminado cuando:** un test genera la disponibilidad de una semana para una clínica y para
un restaurante desde datos sembrados, y otro test demuestra que Postgres rechaza el solape.

### M1 · Reserva pública — semanas 3-6 · 80 h

- API pública: catálogo, disponibilidad, `hold`, confirmación, gestión con `public_token`
- Rate limiting por IP y dominio, lista blanca de dominios, anti-bot
- Página pública en Astro con JSON-LD y Open Graph
- Widget: loader de ~3 KB + iframe, tres modos, auto-altura, evento de conversión
- Expiración de `hold` por `pg_cron`
- Correo de confirmación con `.ics`

**Terminado cuando:** una persona reserva desde una landing real en su teléfono, recibe el
correo, y el horario deja de aparecer para los demás.
**→ Este hito ya se vende empaquetado con tus landings.**

### M2 · Panel — semanas 7-10 · 80 h

- Angular + Tailwind: autenticación, layout, cambio entre negocios (base del Modo Agencia)
- Configuración completa: local, recursos, servicios, horarios, excepciones
- Agenda del día por recurso; reserva manual; llegada, completada, inasistencia; bloqueos
- Vistas específicas por rubro: rejilla de profesionales vs lista de turnos
- Registro de auditoría

**Terminado cuando:** una recepcionista opera un día completo sin ayuda.

### M3 · WhatsApp — semanas 11-15 · 100 h

*Depende de la ruta crítica de Meta. Si a la semana 11 no está aprobada, se adelanta M4.*

- Embedded Signup **v4** y estados de `wa_account`
- Replicación de plantillas maestras por WABA y seguimiento de aprobación
- Envío por Cloud API detrás de la interfaz `MessagingProvider`
- Webhook entrante: firma, botones, texto libre con sinónimos, escalado a bandeja
- `pg_cron` + `pgmq` + worker de mensajes con reintentos y DLQ
- Escalera de confirmación con corte al confirmar (R-10)
- Metering de costos y freno automático por calidad
- Degradación a correo cuando WhatsApp no está activo (HU-10)

**Terminado cuando:** una reserva real recorre confirmación → recordatorio → botón
"Confirmo" → estado actualizado, y `message_log` refleja el costo.

### M4 · Salida y resultado — semanas 16-18 · 60 h

- Webhooks salientes con firma HMAC, reintentos con espera creciente, DLQ
- Panel de entregas con reenvío manual y evento de prueba
- Exportación CSV
- Panel "Dinero Recuperado" con desglose
- Accesibilidad del flujo público y pulido

### Estabilización — semanas 19-20 · 40 h

Clientes reales, errores reales.

---

## 6. Riesgos del plan

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Verificación de Meta rechazada o lenta | 🔴 Alta | Empezar en la semana 1; M1 y M2 no dependen de ella; correo como respaldo permanente |
| Los dos rubros a la vez desbordan el alcance | 🟠 Media | P13 en la constitución; si el core recibe `vertical` como parámetro, parar y corregir el modelo |
| Angular en el panel más lento de lo previsto | 🟡 Baja | Es stack conocido; el riesgo real está en M3, no aquí |
| 20 h/semana no se cumplen | 🟠 Media | Hitos independientes: cada uno entrega valor y se puede pausar entre ellos |
| Meta cambia precios otra vez | 🟠 Media | Metering desde M0 y planes con excedente facturable |

## 7. Lo que este plan NO hace

Rescate de cupo, Confirm Score, depósitos, plano de salón, unión de mesas, walk-ins,
sincronización con Google Calendar y autoservicio de alta. Están en la spec como fuera de
alcance, con su spec futura asignada. **No empezar ninguno antes de la semana 20.**

---

## Siguiente paso

`tasks.md` — desglose ejecutable de M0, tarea por tarea.

## Fuentes

- [Meta — Become a Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers)
- [Meta — App Review para proveedores de soluciones](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review)
- [Meta — Onboard WhatsApp Business app users (Embedded Signup)](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)
- [Infobip — Tech Provider Program paso a paso](https://www.infobip.com/docs/whatsapp/tech-provider-program/setup-and-integration)
- [Twilio — WhatsApp Tech Provider program integration guide](https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/integration-guide)

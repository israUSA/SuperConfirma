# Tareas · Spec 001

Se verifica todo en local con `npm run check` antes de cada commit.

# M0 · Cimientos

_16 de septiembre de 2026 · implementa el hito M0 de [`plan.md`](plan.md)_

Alcance ajustado por D-01 revisado (solo citas con profesional en v1):

- El motor de disponibilidad implementa **solo el modo `slot`**. El modo `shift`
  (restaurantes) queda en el esquema pero su motor pasa a la Spec 001-b.
- La semilla crea **un** negocio de citas. Los tests crean sus propios negocios.
- `pg_cron` y `pgmq` se activan en la migración de M1/M3, cuando algo los use.

**Terminado cuando:** un test genera la disponibilidad de una semana para una clínica desde
datos sembrados, y otro test demuestra que Postgres rechaza el solape.

---

## T0 · Monorepo

- [x] T0.1 `package.json` raíz con workspaces `packages/*`, Node ≥ 22
- [x] T0.2 `tsconfig.base.json` estricto (`strict`, `noUncheckedIndexedAccess`)
- [x] T0.3 ESLint (flat config + typescript-eslint)
- [x] T0.4 Vitest como runner único
- [x] T0.5 Scripts raíz: `lint`, `typecheck`, `test`, `test:db`, `db:start`, `db:reset`

## T1 · `packages/core` (P8: puro, sin I/O, tiempo inyectado)

- [x] T1.1 Tipos del dominio: `BookingStatus`, `AvailabilityRule`, `AvailabilityException`,
      `Busy`, `ServiceSpec`, `BookingWindow`
- [x] T1.2 Máquina de estados: transiciones válidas, `isBlocking(status)`, expiración de `hold`
- [x] T1.3 `occupiedSpan()` — el span real incluye buffers (R-08)
- [x] T1.4 Motor de disponibilidad modo `slot`:
  - [x] reglas semanales en hora local → instantes UTC (P9)
  - [x] reglas por recurso tienen prioridad sobre las del local
  - [x] excepciones `block` (por recurso o todo el local) y `open`
  - [x] el span completo con buffers debe caber en el horario laboral
  - [x] descarta lo que choca con ocupación existente (R-01, R-08)
  - [x] anticipación mínima y máxima (R-09)
  - [x] horas locales inexistentes por cambio de horario se descartan (DST)
- [x] T1.5 Tests: semana completa de una clínica, buffers, bloqueos, ventana, DST, Galápagos
- [x] T1.6 Verificación P8/P13: `core` no depende de I/O y ninguna función recibe `vertical`

## T2 · Base de datos (P1, P2)

- [x] T2.1 `supabase init`, configuración local
- [x] T2.2 Migración 1 · tenancy: `account`, `business`, `location`
- [x] T2.3 Migración 1 · catálogo: `resource`, `service`, `service_resource`,
      `availability_rule`, `availability_exception`, `booking_window` en `location`
- [x] T2.4 Migración 1 · reservas: `booking`, `booking_resource` con `EXCLUDE` parcial
- [x] T2.5 Migración 1 · personas: `contact_identity`, `customer`, `consent`
- [x] T2.6 Migración 1 · mensajería: `wa_account`, `message_template`,
      `wa_template_status`, `message_log` con índice único de idempotencia
- [x] T2.7 Migración 1 · salida: `webhook_endpoint`, `webhook_delivery`
- [x] T2.8 Claves foráneas compuestas `(id, business_id)`: una fila hija no puede apuntar a
      un padre de otro negocio
- [x] T2.9 Trigger `blocking` derivado de `booking.status` (nunca desde la app)
- [x] T2.10 Trigger de capacidad N con `select … for update` (R-02)
- [x] T2.11 Función `expire_holds(now)` (R-04)
- [x] T2.12 RLS: política por `business_id` del JWT en toda tabla de negocio;
      `contact_identity` sin acceso para `anon`/`authenticated`; `anon` sin permisos
- [x] T2.13 `seed.sql`: una clínica en Quito con 2 profesionales, 3 servicios y horario

## T3 · Tests de base de datos (corren contra Postgres real)

- [x] T3.1 Arnés: conexión, transacción con rollback, simulación de JWT por negocio
- [x] T3.2 Invariantes por SQL directo:
  - [x] R-01 solape en el mismo recurso → rechazado
  - [x] R-01 reservas contiguas `[)` → aceptadas
  - [x] R-03 cancelar libera el horario
  - [x] R-04 `expire_holds` libera retenciones vencidas
  - [x] R-02 capacidad N no se supera
  - [x] R-05 mensaje duplicado → rechazado
  - [x] R-08 buffers bloquean aunque el cliente no los vea
  - [x] `blocking` no se puede falsear desde un `update`
  - [x] FK compuesta impide mezclar negocios
- [x] T3.3 **Suite de aislamiento (P1)**:
  - [x] toda tabla de `public` tiene RLS activada
  - [x] toda tabla de `public` está registrada en la suite (tabla nueva sin test = CI rojo)
  - [x] con JWT del negocio A: leer, insertar, actualizar y borrar datos de B → nada
  - [x] `anon` no lee nada; `contact_identity` inaccesible para usuarios del panel
- [x] T3.4 Paridad: `booking_status_blocks()` en SQL == `isBlocking()` del core
- [x] T3.5 Criterio de terminado: disponibilidad de una semana desde la semilla

## T4 · CI

- [x] T4.1 GitHub Actions: lint + typecheck + tests del core
- [x] T4.2 Job de base de datos: `supabase db start` + migraciones + tests de BD
- [~] T4.3 ~~Protección de `main` en GitHub~~ — descartado: se verifica en local con
      `npm run check` antes de cada commit. CI en GitHub queda como respaldo.

---

# M1 · Reserva pública

_Implementa el hito M1 de [`plan.md`](plan.md): HU-03, HU-04, HU-06 y la parte de correo de HU-10._

**Terminado cuando:** una persona reserva desde una landing real en su teléfono, recibe el
correo, y el horario deja de aparecer para los demás.

## M1a · API pública (`packages/api`)

- [x] A1 Migración 2: `business.allowed_origins`, job de `pg_cron` que vence retenciones
- [x] A2 Core: normalización de teléfono a E.164 (Ecuador por defecto), `HOLD_MINUTES = 10`
- [x] A3 Fastify + Zod, logger con PII enmascarada (P7), errores con código estable
- [x] A4 Acceso a datos con transacciones inyectables (los tests hacen rollback)
- [x] A5 `GET /v1/public/:slug` — catálogo público y texto de consentimiento vigente
- [x] A6 `GET /v1/public/:slug/availability` — horarios agrupados por hora
- [x] A7 `POST /v1/public/:slug/holds` — retiene 10 min; revalida contra el motor; asigna
      profesional si el cliente eligió "cualquiera"; `409 slot_taken` si alguien ganó la carrera
- [x] A8 `POST /v1/public/holds/complete` — datos del cliente, consentimiento con el texto
      que emitió el servidor (P6), `hold → pending`; idempotente
- [x] A9 `GET /v1/manage/:token`, `POST …/cancel`, `POST …/reschedule` — sin cuenta (P11)
- [x] A10 Correo de confirmación con `.ics`, detrás de una interfaz de proveedor;
      registrado en `message_log` con costo (P5)
- [x] A11 CORS solo para nuestra web (el widget corre en un iframe de nuestro dominio;
      `allowed_origins` se usa en M1c para `frame-ancestors`) y límite de solicitudes por IP
- [x] A12 Tests de integración contra Postgres real: flujo completo, carrera por el mismo
      horario, retención vencida, token ajeno, origen no autorizado

## M1b · Página pública (`packages/web`, Astro + Preact)

- [ ] B1 Página `/:slug` con el flujo de las pantallas 1 y 2 de pen.dev
- [ ] B2 Estados: retención con contador, retención vencida, horario tomado, confirmación
- [ ] B3 Página `/gestionar/:token` (pantallas 3a y 3b)
- [ ] B4 JSON-LD y Open Graph; accesible con teclado y lector de pantalla

## M1c · Widget embebible (`packages/widget`)

- [ ] C1 Loader < 3 KB que crea el iframe: modos inline, modal y botón flotante
- [ ] C2 Auto-altura por `postMessage` y evento de conversión para el píxel del dueño
- [ ] C3 Preselección de servicio y profesional desde el código de instalación
- [ ] C4 Página de prueba que lo incrusta en una landing de ejemplo

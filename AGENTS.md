# AGENTS.md — Traspaso para quien continúe

Léelo completo antes de tocar código. Resume todo lo que no se puede deducir leyendo el
repositorio: decisiones, contexto del dueño, trampas ya encontradas y qué sigue.

_Última actualización: 16 de septiembre de 2026 · último commit: M1a (API pública)_

---

## 1. Qué es esto

**SuperConfirma**: SaaS de agendamiento y confirmación de citas para negocios en Ecuador,
pensado para venderse empaquetado con landing pages. La tesis: **no vender "agenda", vender
asistencia**. El diferencial es reducir inasistencias (confirmación por WhatsApp,
recordatorios y, más adelante, rescate de cupos) y mostrar el dinero recuperado.

## 2. El dueño del proyecto

- Escribe en **español informal**, con errores de tipeo. Responde en español, claro y directo.
- Vende landing pages; busca ingreso recurrente. No conoce a fondo ni clínicas ni restaurantes.
- Stack que conoce: **Angular + Tailwind**.
- **Diseña él mismo** en pen.dev (conectado a Antigravity). No diseñes pantallas por tu
  cuenta: implementa las suyas. Puedes leer el `.pen` por MCP si lo tiene abierto.
- Trabaja **solo** (un desarrollador) y dedica **20 h/semana**.
- Pidió explícitamente: **verificar en local**, sin reglas de protección de rama en GitHub.
  Antes de cada commit corre `npm run check`.
- Pide confirmación antes de subir: haz commit cuando termines algo, y **push solo cuando lo pida**.

## 3. Metodología: Spec-Driven Development

Orden obligatorio: **spec → plan → tasks → código** (principio P14).

| Documento | Para qué |
|---|---|
| [`specs/constitution.md`](specs/constitution.md) | 14 principios no negociables. **Léelo primero.** |
| [`specs/001-mvp-agendamiento/spec.md`](specs/001-mvp-agendamiento/spec.md) | Historias de usuario HU-01…HU-11 y reglas R-01…R-11 |
| [`specs/001-mvp-agendamiento/plan.md`](specs/001-mvp-agendamiento/plan.md) | Decisiones técnicas T-01…T-10, hitos M0–M4 |
| [`specs/001-mvp-agendamiento/tasks.md`](specs/001-mvp-agendamiento/tasks.md) | Tareas con casillas. **Aquí está el estado real.** |
| [`docs/decisiones-abiertas.md`](docs/decisiones-abiertas.md) | Decisiones D-01…D-15 y su razonamiento |
| [`docs/investigacion/`](docs/investigacion) | Investigación de mercado, WhatsApp, dominio, stack, embed, diferenciadores, negocio |

Principios que más se violan sin querer:

- **P1** Aislamiento entre negocios probado: toda tabla nueva va en el `REGISTRY` de
  `packages/db-tests/test/isolation.test.ts`, o los tests fallan.
- **P2** Invariantes en la base, no en `if` de la app.
- **P3** Ningún mensaje sale dos veces: la fila de `message_log` se inserta **antes** de enviar.
- **P4** El widget nunca habla con Supabase; todo pasa por `packages/api`.
- **P7** Sin datos personales en logs; los mensajes **no nombran el servicio** si
  `service.sensitive` (por defecto `true`).
- **P8** `packages/core` es puro: sin I/O y sin `Date.now()`. Lo impone ESLint.
- **P13** Un solo núcleo para todos los rubros: ninguna función del core recibe `vertical`.
  También lo impone ESLint.

## 4. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Rubro v1 | **Solo citas con profesional** (clínicas, estética, barbería…). Restaurantes en v2 (Spec 001-b); el esquema ya los soporta |
| Mercado | **Ecuador**: USD, sin horario de verano, ley LOPDP. Zonas `America/Guayaquil` y **`Pacific/Galapagos`** |
| WhatsApp | **Número propio por negocio** (Embedded Signup **v4**; la v2 se depreca el 8-oct-2026) |
| Operación año 1 | Servicio gestionado, con arquitectura de autoservicio (`account` ≠ `business`) |
| Fuera del MVP | Rescate de cupo, Confirm Score, **anticipos/depósitos**, plano de salón, Google Calendar bidireccional |
| Pagos | No en el MVP. Cuando lleguen: Kushki o PayPhone (Stripe no opera en Ecuador), modelo "conectado" |
| Correo | Resend, detrás de la interfaz `EmailSender` |

## 5. Estado actual

| Hito | Estado |
|---|---|
| M0 · Cimientos (esquema, RLS, motor de disponibilidad) | ✅ Hecho |
| **M1a · API pública** | ✅ Hecho |
| **M1b · Página pública (Astro + Preact)** | ⏭️ **Siguiente** |
| M1c · Widget embebible | Pendiente |
| M2 · Panel (Angular + Tailwind) | Pendiente |
| M3 · WhatsApp | Pendiente; depende de que el dueño termine los trámites con Meta |
| M4 · Webhooks, CSV y "dinero recuperado" | Pendiente |

`npm run check` → **213 tests en verde** (core, invariantes de la base, aislamiento, API).

## 6. Puesta en marcha en otra computadora

Requisitos: **Node 22+** (se usó el 25) y **Docker Desktop encendido**.

```bash
git clone https://github.com/israUSA/SuperConfirma.git
cd SuperConfirma
npm install
npm run db:start      # la primera vez descarga ~2 GB de imágenes de Supabase; tarda
npm run check         # lint + tipos + todos los tests
npm run api:dev       # API en http://127.0.0.1:8787
```

- Si cambias migraciones o la semilla: `npm run db:reset`.
- Para apagar la base: `npm run db:stop`.
- La CLI de Supabase viene como dependencia de desarrollo (`npx supabase …`); no hace falta instalarla global.
- Postgres local: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

Variables de entorno de la API (todas opcionales en local):

| Variable | Default | Nota |
|---|---|---|
| `DATABASE_URL` | Postgres local | |
| `PORT` / `HOST` | `8787` / `127.0.0.1` | |
| `PUBLIC_WEB_URL` | `http://localhost:4321` | Base de los enlaces `/gestionar/:token` |
| `CORS_ORIGINS` | = `PUBLIC_WEB_URL` | Separadas por coma |
| `RESEND_API_KEY`, `EMAIL_FROM` | — | Sin ellas, los correos quedan en memoria y no se envían |

## 7. Mapa del código

```
packages/core/        dominio puro: disponibilidad (modo slot), estados, teléfono
packages/api/         Fastify + Zod + postgres.js
  src/app.ts          rutas, CORS, límite de solicitudes, manejo de errores
  src/bookings.ts     retener, completar, cancelar, reprogramar
  src/catalog.ts      lecturas y armado de la consulta del motor
  src/email/          confirmación, .ics, proveedores
  test/harness.ts     cada test corre en una transacción que se revierte
packages/db-tests/    invariantes y aislamiento por SQL directo
supabase/migrations/  fuente de verdad del esquema (el SQL de plan.md es solo el borrador)
supabase/seed.sql     "Aura Estética Avanzada", Quito: Dra. Valeria Paredes y Lic. Mateo Andrade
```

Contrato de la API (los códigos de `error` son estables; la UI los traduce):

| Ruta | Respuestas relevantes |
|---|---|
| `GET /v1/public/:slug` | catálogo |
| `GET /v1/public/:slug/availability?locationId&serviceId&resourceId?&from&to` | `{ timezone, slots:[{start, options:[{resourceId,end}]}] }` |
| `POST /v1/public/:slug/holds` `{locationId, serviceId, resourceId?, start, source}` | `201 {token, resourceId, start, end, holdExpiresAt, consent}` · `409 slot_unavailable / slot_taken` |
| `POST /v1/public/holds/complete` `{token, name, phone, email?, consent:true, consentVersion, source, website?}` | `200 {bookingId, status, manageUrl}` · `410 hold_expired` · `422 phone_not_mobile / phone_invalid` · `409 consent_outdated` |
| `GET /v1/manage/:token` | detalle, con `canCancel` y `canReschedule` |
| `POST /v1/manage/:token/cancel` | `409 booking_closed / booking_started` |
| `POST /v1/manage/:token/reschedule` `{start, resourceId?}` | `200 {id, status, start, end, resourceId, manageUrl}` (el token cambia) |

`website` es un campo trampa para bots: la UI debe renderizarlo oculto y vacío.

## 8. Trampas ya encontradas (no las repitas)

- **Zod 4:** `z.uuid()` exige UUID RFC estricto y rechaza los IDs de la semilla. Usa `z.guid()`.
- **Node ejecuta TypeScript quitando los tipos** (`node src/server.ts`), así que no hay
  `enum` ni propiedades declaradas en el constructor. `erasableSyntaxOnly` lo impide.
- **Fastify + `@fastify/rate-limit`:** las rutas deben declararse dentro de un plugin
  registrado después del de rate-limit; si no, los límites por ruta se ignoran sin avisar.
- **Postgres:** `x = any((select f()))` falla; usa `x = any((select f())::uuid[])`.
- **postgres.js** devuelve `bigint` como string.
- **Supabase concede `EXECUTE` en funciones por defecto.** Las de `app_private` se revocan
  explícitamente; el panel solo ejecuta las funciones puras que necesitan las políticas.
- **`TRUNCATE` se salta RLS:** está revocado para `authenticated`.
- **`EXCLUDE` solo aplica a recursos de capacidad 1** (columna `exclusive`); la capacidad N
  la valida un trigger que mide ocupación simultánea.
- **Galápagos es `Pacific/Galapagos`**; `America/Galapagos` no existe.
- **Windows / Git Bash:** los heredocs con backticks y `${}` dentro de `node -e` se rompen.
  Usa `node - <<'EOF'` o la herramienta de edición. Las advertencias LF→CRLF son normales.
- `python` en esta máquina es el stub de la Microsoft Store y se cuelga; no lo uses.
- La primera descarga de imágenes de Supabase puede superar los timeouts; córrela en segundo plano.

## 9. Siguiente trabajo: M1b · Página pública

Tareas B1–B4 en `tasks.md`. Stack decidido: **Astro + islas Preact** (T-05), en `packages/web`.

**Diseño:** el dueño tiene 13 pantallas en pen.dev, ya revisadas y corregidas contra la
spec. Las que corresponden a M1b son:

- **Pantalla 1** — landing con formulario embebido de un solo paso (servicio → día → hora → datos → consentimiento → botón "Confirmar Cita — Recibir en WhatsApp").
- **Pantalla 2** — reserva móvil de una sola vista (375 px), con el aviso "Retenido 10 min".
- **Pantalla 3a** — "Gestionar Mi Cita": resumen, botón "Cambiar Horario de Cita" y botón "Cancelar Esta Cita" (rojo suave).
- **Pantalla 3b** — "Tu cita ha sido cancelada": resumen y botón "Agendar Nueva Cita". Sin montos de dinero.

Estilo: editorial sobrio. Fondo crema, verde muy oscuro (~`#1F3A2E`) como acento, títulos
con serif, texto con sans. El acento debe quedar como token, porque cada negocio lo
personaliza (marca blanca).

Reglas de UI que salen de la spec y de la revisión de diseño:

- El texto del checkbox es **exactamente** el `consent.text` que devuelve la API (hoy:
  "Acepto recibir confirmaciones y recordatorios de esta cita por WhatsApp"). Envía `consentVersion`.
- Contador visible de la retención; si vence (`410`), avisa claramente y vuelve a la elección de hora sin perder lo demás.
- Si la API responde `409 slot_taken` o `slot_unavailable`, recarga los horarios y avisa.
- Todo funciona con teclado y lector de pantalla, en un teléfono de gama baja.
- `/gestionar/:token` usa `/v1/manage/*`. Tras reprogramar, redirige al `manageUrl` nuevo.
- Página del negocio con JSON-LD (`LocalBusiness`) y Open Graph.
- Muestra las horas en la zona del local (`timezone` de la API), no en la del navegador.

Después viene **M1c** (widget): un loader de menos de 3 KB que crea un iframe apuntando a
`packages/web`, con modos inline, modal y botón flotante, auto-altura por `postMessage` y
evento de conversión. El `business.allowed_origins` va en la cabecera CSP `frame-ancestors`
de la página embebida.

## 10. Pendientes del dueño, fuera del código

- Trámites de Meta (ruta crítica de M3): dominio propio, RUC, cuenta de Meta Business con
  verificación, App Review, Access Verification, alta como Tech Provider y una línea
  telefónica dedicada. Tarda de 2 a 6 semanas.
- Cuenta de Resend y dominio verificado para el correo.
- Verificar la marca "SuperConfirma" en el SENADI.
- Preguntas abiertas: los 3 negocios piloto, presupuesto mensual, y si el widget vivirá
  sobre todo en sus propias landings o en sitios de terceros.

## 11. Convenciones

- Código e identificadores en inglés; documentos, mensajes de UI y commits en español.
- Sin comentarios obvios; solo el porqué cuando no se deduce.
- Commits en español, explicando el porqué, con la línea de coautoría del agente.
- Una migración nueva por hito (`supabase/migrations/AAAAMMDDhhmmss_nombre.sql`);
  nunca edites una migración ya subida.

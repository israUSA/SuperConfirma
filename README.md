# SuperConfirma

Plataforma de **agendamiento y confirmación de citas/reservas** multi-vertical (clínicas,
restaurantes, servicios), embebible en landing pages y conectable a otras plataformas
vía API y webhooks.

> Estado: **M0 · Cimientos** — esquema, aislamiento y motor de disponibilidad.
> Metodología: Spec-Driven Development (spec → plan → tasks → implement).

## Tesis del producto

El mercado está lleno de software que **agenda**. Casi ninguno se especializa en que la
cita **efectivamente ocurra**. SuperConfirma ataca el no-show: confirma, reprograma,
rescata cupos liberados y mide el dinero recuperado.

## Índice de la investigación

| Doc | Contenido |
|---|---|
| [00 - Resumen ejecutivo](docs/investigacion/00-resumen-ejecutivo.md) | Conclusiones, economía del producto, recomendación |
| [01 - Mercado y competencia](docs/investigacion/01-mercado-y-competencia.md) | Quién juega, precios, huecos del mercado |
| [02 - WhatsApp y notificaciones](docs/investigacion/02-whatsapp-y-notificaciones.md) | Cloud API, costos, cambio del 1-oct-2026, plantillas |
| [03 - Modelo de dominio](docs/investigacion/03-modelo-de-dominio.md) | La abstracción que cubre clínica + restaurante + otros |
| [04 - Stack y arquitectura](docs/investigacion/04-stack-y-arquitectura.md) | Angular/Supabase, multi-tenancy, anti double-booking |
| [05 - Embed, API y webhooks](docs/investigacion/05-embed-api-webhooks.md) | Cómo se pone en una landing y cómo salen los datos |
| [06 - Diferenciadores](docs/investigacion/06-diferenciadores.md) | Lo que no tiene nadie más |
| [07 - Negocio, precios y legal](docs/investigacion/07-negocio-precios-legal.md) | Pricing, pasarelas, LOPDP |
| [Decisiones](docs/decisiones-abiertas.md) | Lo resuelto y lo que falta |

Brief publicado (versión leíble y compartible): https://claude.ai/artifact/L44uMJ61dtyCacJXd2EMPP

## Decisiones tomadas

- **Rubro v1:** citas con profesional (restaurantes en v2, sobre el mismo núcleo)
- **Mercado:** Ecuador (USD, sin horario de verano, LOPDP)
- **WhatsApp:** número propio por negocio
- **Operación año 1:** servicio gestionado, con arquitectura de autoservicio desde el día 1

## Especificaciones

| Doc | Estado |
|---|---|
| [Constitución](specs/constitution.md) | v1.0 — principios no negociables |
| [Spec 001 · MVP de agendamiento](specs/001-mvp-agendamiento/spec.md) | Revisada |
| [Plan 001](specs/001-mvp-agendamiento/plan.md) | Hitos M0–M4 |
| [Tareas M0](specs/001-mvp-agendamiento/tasks.md) | En curso |

Los prototipos de interfaz viven en pen.dev (13 pantallas revisadas contra la spec).

## Desarrollo

Requisitos: Node 22+ y Docker.

```bash
npm install
npm run db:start      # Postgres local de Supabase, con migraciones y semilla
npm test              # packages/core, sin infraestructura
npm run test:db       # invariantes y aislamiento contra Postgres real
npm run lint && npm run typecheck
```

| Carpeta | Contenido |
|---|---|
| `packages/core` | Dominio puro: motor de disponibilidad y máquina de estados (P8) |
| `packages/db-tests` | Tests que atacan la base saltándose la app (P1, P2) |
| `supabase/migrations` | Esquema SQL versionado, RLS y triggers |
| `supabase/seed.sql` | Clínica de ejemplo en Quito |

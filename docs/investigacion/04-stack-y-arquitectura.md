# 04 · Stack y arquitectura

## 1. Arquitectura propuesta

```
┌─────────────────────────────────────────────────────────────────────┐
│  SUPERFICIES PÚBLICAS                                               │
│                                                                     │
│  Widget embebido       Página pública        WhatsApp               │
│  <script> → iframe     reservas.tu.com/x     (entrada del cliente)  │
│  (Preact/Svelte)       (SSR/SSG, SEO)                               │
└───────────┬────────────────────┬──────────────────┬─────────────────┘
            │                    │                  │
            ▼                    ▼                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  API PÚBLICA / BFF   (Node: NestJS o Fastify · o Edge Functions)    │
│                                                                     │
│  /public/v1/*   disponibilidad, crear hold, confirmar reserva       │
│  /api/v1/*      API con API-key para integradores                   │
│  /webhooks/whatsapp   entrada de Meta (firma verificada)            │
│                                                                     │
│  ▸ rate limiting · anti-bot · validación · lógica de dominio        │
│  ▸ NUNCA expone la base directamente                                │
└───────────┬─────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  SUPABASE (PostgreSQL)                                              │
│  ▸ Datos + RLS (aislamiento por tenant)                             │
│  ▸ Auth (panel de administración)                                   │
│  ▸ Storage (logos, imágenes de servicios)                           │
│  ▸ pg_cron   → dispara recordatorios cada minuto                    │
│  ▸ pgmq      → colas: envío de mensajes, entrega de webhooks        │
│  ▸ EXCLUDE gist → anti double-booking                               │
└───────────┬─────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  WORKERS (consumen pgmq)                                            │
│  ▸ message-worker    → WhatsApp Cloud API / SMS / email             │
│  ▸ webhook-worker    → entrega saliente + reintentos + DLQ          │
│  ▸ rescue-worker     → rescate de cupo y lista de espera            │
│  ▸ score-worker      → recálculo del Confirm Score                  │
└─────────────────────────────────────────────────────────────────────┘
            ▲
            │
┌───────────┴─────────────────────────────────────────────────────────┐
│  PANEL DE ADMINISTRACIÓN  ·  Angular + Tailwind                     │
│  Agenda, reservas, clientes, plantillas, métricas, Modo Agencia     │
└─────────────────────────────────────────────────────────────────────┘
```

## 2. Frontend: la decisión que hay que matizar

### Panel de administración → **Angular + Tailwind** ✅

Es la elección correcta. Es una app privada, tras login, con formularios complejos,
tablas y una vista de calendario. Angular brilla ahí (tipado fuerte, DI, formularios
reactivos, estructura para un proyecto que va a crecer). El peso del bundle es
irrelevante porque nadie evalúa tu producto por el LCP del panel.

### Widget público → **Angular NO** ⚠️

Este es el punto donde hay que discrepar de la propuesta inicial.

El widget se incrusta en **landings de tus clientes**, donde:

- El LCP y el CLS de esa landing son tu responsabilidad (y afectan su SEO).
- Cada KB cuenta: el widget es el paso previo a la conversión.
- El CSS del sitio anfitrión puede romper tu UI (y viceversa).

Angular con SSR es viable, pero arrastra peso; además, Angular 21 cambió el builder y el
formato de bundle para SSR, con fricción conocida en desarrollo local. Para un widget de
"elegir servicio → día → hora → datos", es sobreingeniería.

| Opción | Peso aprox. | Veredicto |
|---|---|---|
| Angular + SSR | 150–250 KB | ⚠️ Funciona, pero paga un impuesto en cada landing |
| **Preact / Svelte** | **10–30 KB** | ✅ **Recomendado** |
| Astro (página pública) + isla interactiva | ~15 KB JS | ✅ Ideal si la página pública importa para SEO |
| Vanilla JS + Web Components | <10 KB | ✅ Máximo control, más trabajo |

**Costo de la decisión:** dos stacks de frontend. Es real, pero el widget es pequeño y
estable (una vez que funciona casi no se toca), mientras que el panel crece
constantemente. El intercambio vale la pena.

> Si prefieres un solo stack a toda costa: Angular con **SSG** para la página pública y
> `@defer` agresivo en el widget. Es peor, pero es defendible si el tiempo de aprendizaje
> pesa más que los milisegundos.

## 3. Backend: Supabase sí, pero con reglas

Supabase es la elección correcta: Postgres gestionado, Auth, RLS, Storage, `pg_cron`
(habilitado por defecto en todos los planes), `pgmq` para colas y Edge Functions.
Ahorra meses de trabajo de plomería.

### 🔴 Regla #1: el widget público NUNCA habla con Supabase directamente

Es el error más frecuente al construir un SaaS con Supabase. El flujo de reserva es
**anónimo**: no hay `auth.uid()`, así que RLS no tiene sobre qué decidir. Si expones la
`anon key` en el widget:

- Cualquiera puede enumerar servicios, recursos, horarios y potencialmente clientes.
- No hay rate limiting.
- No hay protección anti-bot ni anti-spam de reservas falsas.

**Por tanto:** todo lo público pasa por una API propia con `service_role`, que valida
tenant, aplica límites de tasa y contiene la lógica de negocio. Supabase queda como base de
datos + auth del panel, no como backend público.

### 🔴 Regla #2: RLS con claims en el JWT, no con subqueries

El error clásico de performance: una policy que hace `SELECT` sobre una tabla de
membresías se ejecuta **por cada fila escaneada**. Con un millón de filas, la subquery corre
un millón de veces y anula los índices.

```sql
-- ❌ MAL: subquery por fila
CREATE POLICY p ON booking FOR SELECT USING (
  tenant_id IN (SELECT tenant_id FROM membership WHERE user_id = auth.uid())
);

-- ✅ BIEN: el tenant viaja en el JWT (custom claims vía Auth Hook)
CREATE POLICY p ON booking FOR SELECT USING (
  tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
);
```

Complementos obligatorios:

- `tenant_id` en **todas** las tablas, con índice (`(tenant_id, ...)` como primera columna
  de los índices compuestos).
- RLS activada en **todas** las tablas alcanzables por `anon` y `authenticated`.
- **Tests automáticos de aislamiento**: una suite que, con el JWT del tenant A, intente leer
  y escribir datos del tenant B y falle en todos los casos. Esto corre en CI en cada PR.
  Es la prueba que te permite dormir tranquilo vendiendo a clínicas.

### Regla #3: jobs y colas dentro de Postgres

```
pg_cron (cada minuto)
  └─ busca reservas que necesitan recordatorio en esta ventana
     └─ encola en pgmq: { type: 'send_reminder', booking_id, template }

message-worker (consume pgmq)
  └─ resuelve plantilla + variables
     └─ envía por MessagingProvider
        └─ registra en message_log (costo, estado, provider_message_id)
           └─ si falla → reintento con backoff; tras N intentos → DLQ + alerta
```

`pg_cron` está habilitado por defecto en Supabase y admite cadencia de segundos; combinado
con `pg_net` puede invocar Edge Functions. `pgmq` requiere Postgres ≥ 15.6.

⚠️ **Idempotencia**: el peor bug posible de este producto es mandarle 7 WhatsApps al mismo
paciente. Cada job lleva una clave única (`booking_id + tipo + ventana`) con un índice
único en `message_log` que hace el envío duplicado imposible a nivel de base de datos.

## 4. Alternativa si Supabase no convence

| | Supabase | NestJS + Postgres gestionado (Neon/Railway) |
|---|---|---|
| Velocidad inicial | 🟢 Muy alta | 🟠 Media |
| Auth | 🟢 Incluida | 🟠 BetterAuth / Lucia |
| Control | 🟠 Medio | 🟢 Total |
| Costo inicial | 🟢 $0 → $25/mes | 🟠 $20–40/mes |
| Riesgo de vendor lock-in | 🟠 Medio (es Postgres estándar, se puede migrar) | 🟢 Bajo |
| Multi-tenant a escala | 🟢 Bien con RLS correcta | 🟢 Bien |

**Veredicto:** Supabase. El lock-in real es bajo porque debajo hay Postgres puro; si algún
día hay que salir, se migra la base y se reescribe solo Auth. La velocidad de arranque vale
mucho más en esta etapa.

## 5. Estructura de repositorio (monorepo)

```
superconfirma/
├── apps/
│   ├── admin/          Angular + Tailwind (panel)
│   ├── booking/        Widget público + página de reserva (Preact/Astro)
│   ├── api/            API pública / BFF (NestJS o Fastify)
│   └── workers/        Consumidores de pgmq
├── packages/
│   ├── core/           Dominio puro: disponibilidad, estados, reglas. Sin I/O. Testeable.
│   ├── db/             Migraciones SQL, tipos generados, seeds
│   ├── messaging/      MessagingProvider + WhatsApp Cloud + SMS + email
│   └── shared/         Tipos, validadores (zod), utilidades de fecha/zona
├── specs/              Spec-Driven Development
│   ├── constitution.md
│   └── NNN-feature/    spec.md · plan.md · tasks.md
└── docs/               Esta investigación
```

**`packages/core` es la pieza clave**: el cálculo de disponibilidad, la máquina de estados
y las reglas de la escalera de confirmación deben ser funciones puras, sin base de datos
ni HTTP. Así se testean exhaustivamente (incluidos los casos de zona horaria y DST) sin
levantar infraestructura.

## 6. Metodología: Spec-Driven Development

Encaja bien con este proyecto y con Claude Code. El flujo es
**`/specify` → `/plan` → `/tasks` → `/implement`**, con el código generado *desde* la
especificación y trazable a ella. GitHub Spec Kit (`specify` CLI) es agent-agnostic y
soporta Claude Code; reportes de la comunidad mencionan 60–80 % menos ciclos de retrabajo
frente a trabajar solo a base de prompts.

Orden propuesto:

1. **`constitution.md`** — principios no negociables del proyecto: multi-tenant estricto,
   idempotencia en todo envío, ninguna reserva sin restricción de base, todo evento
   auditable, sin PII en logs.
2. Una carpeta `specs/NNN-feature/` por funcionalidad, con `spec.md` (qué y por qué,
   sin tecnología), `plan.md` (cómo) y `tasks.md` (pasos ejecutables).
3. Cada spec cierra con criterios de aceptación verificables.

> No hace falta adoptar Spec Kit al pie de la letra: la estructura de carpetas y la
> disciplina de "spec antes que código" es el 90 % del beneficio.

## 7. Costos de infraestructura estimados

| Etapa | Infra | Costo/mes |
|---|---|---|
| Desarrollo | Supabase Free + Vercel/Netlify Free | **$0** |
| 1–20 negocios | Supabase Pro ($25) + hosting ($0–20) + WhatsApp variable | **~$30–60** |
| 20–100 negocios | Supabase Pro + workers en Fly/Railway ($10–30) | **~$60–120** |
| 100+ | Supabase Team + réplicas + observabilidad | **$300+** |

El costo de infra es marginal frente al de mensajería. **El margen se define en el diseño
de la cadencia de mensajes**, no en el hosting.

## 8. Observabilidad mínima (no opcional)

- **Log estructurado por reserva**: toda la línea de tiempo (creada → mensaje → respuesta →
  confirmada → llegó) consultable en una vista. Es la primera pregunta de cada ticket de
  soporte: *"¿le llegó el WhatsApp o no?"*.
- **Alertas**: calidad del número en rojo, cola de mensajes atascada, webhooks fallando,
  tasa de entrega por debajo del umbral.
- **Panel de costos por tenant**: mensajes enviados vs incluidos en el plan.
- **Sin PII en logs**: teléfonos y nombres enmascarados.

---

## Fuentes

- [Makerkit — Multi-tenant SaaS architecture con Postgres RLS](https://makerkit.dev/blog/tutorials/multi-tenant-saas-architecture)
- [Makerkit — Supabase RLS best practices](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices)
- [MetaDesign — Supabase RLS patterns: production guide for multi-tenant SaaS](https://metadesignsolutions.com/blog/supabase-rls-patterns-production-guide-multi-tenant-saas)
- [Supabase Docs — pg_cron](https://supabase.com/docs/guides/database/extensions/pg_cron)
- [Supabase Docs — Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
- [Supascale — Background jobs y colas con pgmq](https://www.supascale.app/blog/background-jobs-and-queues-for-selfhosted-supabase-with-pgmq)
- [StackInsight — Angular 21 SSR: qué cambió y qué se rompió](https://stackinsight.dev/blog/angular-21-ssr-local-development/)
- [GitHub Spec Kit — documentación](https://github.github.com/spec-kit/)
- [GitHub Blog — Spec-driven development with AI](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/)

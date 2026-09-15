# Decisiones

Cada decisión lleva su recomendación original y, si ya está cerrada, lo que se resolvió.

---

## ✅ Decisiones tomadas — 14 de septiembre de 2026

| # | Decisión | Resuelto | Nota |
|---|---|---|---|
| D-01 | Rubro de arranque | **Citas con profesional primero, restaurantes en v2** — revisado el 15-sep | Vuelta a la recomendación original: acorta la ruta al MVP funcional. El esquema y el core ya soportan ambos rubros (P13); solo se recorta qué UI y qué piloto se construyen primero |
| D-02 | Mercado inicial | **Ecuador** | USD, sin horario de verano, LOPDP. Ojo: Galápagos es `America/Galapagos` (UTC-6) |
| D-03 | Número de WhatsApp | **Propio por negocio** | Implica Embedded Signup en el MVP + plantillas replicadas y aprobadas por cada WABA + estado "agenda viva, WhatsApp pendiente" (HU-10) |
| D-04 | Operación año 1 | **Servicio gestionado con arquitectura de autoservicio** | `account` ≠ `business` desde el día 1 |

Consecuencias recogidas en [`specs/constitution.md`](../specs/constitution.md) y
[`specs/001-mvp-agendamiento/spec.md`](../specs/001-mvp-agendamiento/spec.md).

---

## 🔴 Bloqueantes (cerradas — se conserva el razonamiento)

### D-01 · ¿Qué vertical arranca?

Restaurante y clínica **no son el mismo producto** (ver
[03 - Modelo de dominio](investigacion/03-modelo-de-dominio.md)). Hacer los dos a la vez
duplica el trabajo y retrasa todo.

| Opción | Implicación |
|---|---|
| **A. Citas con profesional** (clínicas, estética, barbería, veterinaria, talleres) | Capacidad 1, modelo simple, 4 verticales con el mismo código |
| B. Restaurantes | Mesas combinables, turnos, walk-ins. Más complejo, mercado más caro de atender |
| C. Los dos | Retrasa el MVP al menos 6 semanas |

> **Recomendación: A.** Es la base sobre la que después se construyen los restaurantes sin
> rehacer nada. Además tú no conoces ninguno de los dos rubros a fondo, y el de citas es
> mucho más fácil de entender y validar.

### D-02 · ¿Qué país/mercado primero?

Define moneda, pasarela, zona horaria, tarifas de WhatsApp, ley de datos y hasta el copy.

> **Recomendación:** empezar por **tu país**, donde tienes clientes de landing pages y
> puedes visitarlos. Expandir después. Si es Ecuador: sin horario de verano (simplifica),
> sin Stripe (usar Kushki/PayPhone), LOPDP como marco legal.

### D-03 · ¿Modelo de número de WhatsApp?

| Opción | Onboarding | Marca | Riesgo | Costo |
|---|---|---|---|---|
| Número compartido de SuperConfirma | ⚡ Inmediato | Se ve tu marca | 🔴 Un cliente spammer afecta a todos | Tier gratis compartido |
| Número propio por negocio | 🐢 Días | Se ve el negocio | 🟢 Aislado | 1.000 servicios gratis c/u |
| **Híbrido** | ⚡ Inmediato → migra | Mejora al migrar | 🟠 Controlado | Lo mejor de ambos |

> **Recomendación: híbrido.** Compartido en prueba y plan Esencial, propio desde Pro
> (usando Embedded Signup de Meta).

### D-04 · ¿Producto autoservicio o servicio de agencia?

| Opción | Implicación en el producto |
|---|---|
| A. SaaS autoservicio | Onboarding sin fricción, autoconfiguración, cobro con tarjeta, soporte escalable |
| B. Servicio gestionado (tú configuras todo) | Menos UI, más manual, más margen por cliente, no escala |
| **C. Ambos desde el diseño** | Modo Agencia desde el inicio; el autoservicio llega después |

> **Recomendación: C**, arrancando operativamente por B (tú configuras a tus primeros
> clientes) pero **con la arquitectura de A** (`account` ≠ `business`), para no reescribir
> después.

---

## 🟠 Importantes (definen el alcance del MVP)

### D-05 · ¿El widget se hace en Angular o en algo más ligero?

> **Recomendación: algo ligero (Preact/Svelte/Astro).** Ver
> [04 - Stack](investigacion/04-stack-y-arquitectura.md#2-frontend-la-decisión-que-hay-que-matizar).
> El panel sí en Angular. Si prefieres un solo stack, se puede hacer todo en Angular con
> SSG, asumiendo peor rendimiento en las landings de tus clientes.

### D-06 · ¿Pagos y anticipos entran en el MVP?

Añade pasarela, conciliación, reembolsos y soporte. **Recomendación: no en el MVP.**
Fase 3, junto con el Confirm Score, que es lo que los hace inteligentes.

### D-07 · ¿Sincronización con Google Calendar en el MVP?

Muy pedida por profesionales independientes, pero es una épica completa (OAuth, tokens,
canales push, conflictos). **Recomendación:** `.ics` en el correo + feed de solo lectura en
el MVP; bidireccional en fase 2.

### D-08 · ¿Multi-local desde el inicio?

Modelar `account → business → location` desde el día 1 **sí** (cuesta poco en el esquema);
exponerlo en la interfaz, en fase 2.

### D-09 · ¿Idiomas?

> **Recomendación:** solo español en el MVP, pero con las cadenas externalizadas desde el
> inicio. Agregar inglés después cuesta poco si no se hardcodea nada.

### D-10 · ¿Marca blanca total en qué nivel?

Subdominio propio, logo y colores es fácil. Dominio propio con certificado automático y
remitente de correo verificado es más trabajo (DNS, SSL, SPF/DKIM). **Recomendación:**
subdominio + branding en fase 2; dominio propio completo en fase 3.

---

## 🟡 A definir, pero no urgentes

| # | Decisión | Recomendación inicial |
|---|---|---|
| D-11 | Nombre de dominio y marca | Verificar disponibilidad de `superconfirma.com` / `.app` / `.io` y la marca registrada en tu país |
| D-12 | ¿Open source parcial? | No. El código cerrado, pero la **API y los webhooks abiertos y bien documentados** |
| D-13 | ¿App móvil? | No. Web responsive + PWA para el panel si hace falta |
| D-14 | ¿Chatbot de IA conversacional? | Solo acotado a agendar/reprogramar/cancelar. Nada de asistente general |
| D-15 | ¿Soporte a canchas/clases (capacidad N)? | Diseñar el esquema para soportarlo; activarlo en fase 2 (es casi gratis si el modelo está bien) |

---

## Preguntas todavía pendientes

Ninguna bloquea la spec, pero sí el plan y el tamaño realista del MVP:

1. **¿Tienes ya cuenta de Meta Business verificada?** Con número propio por negocio (D-03)
   esto es lo primero de la ruta crítica: tarda días y bloquea toda prueba real.
2. **¿Cuánto tiempo semanal le vas a dedicar?** 20 h/semana ≠ 5 h/semana cambia el MVP de
   6 a 14 semanas. Es el dato que más falta para el plan.
3. **¿Qué negocios concretos serán los 3 pilotos?** Con ambos rubros en el MVP hacen falta
   al menos uno de cada uno, y su realidad define qué se construye primero.
4. **¿Presupuesto mensual para infraestructura y mensajes?** Con $0 el diseño cambia
   (todo en capa gratuita).
5. **¿Trabajas solo o hay más gente?** Define cuánta ceremonia de proceso conviene.
6. **¿El widget vivirá mayormente en tus propias landings o en webs de terceros?** Cambia
   cuánto invertir en compatibilidad y CSP.

---

## Siguiente paso

1. ~~Escribir `specs/constitution.md`~~ ✅
2. ~~Escribir `specs/001-mvp-agendamiento/spec.md`~~ ✅ — **pendiente de tu revisión**
3. `plan.md` técnico (esquema de datos, decisiones de arquitectura) — necesita la
   pregunta 2 respondida
4. `tasks.md` ejecutable
5. Migración inicial de base de datos + tests de aislamiento entre tenants
6. Recién ahí, código de aplicación

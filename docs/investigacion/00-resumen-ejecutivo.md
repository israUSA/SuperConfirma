# 00 · Resumen ejecutivo

_Investigación realizada: 14 de septiembre de 2026._

---

## 1. La conclusión principal: no vendas "agenda", vende "asistencia"

Hay decenas de plataformas que resuelven *agendar*. Solo AgendaPro tiene **20.000+ negocios
en LatAm** y arranca en ~$19/usuario/mes. Competir de frente contra eso con "otra agenda
online" es una guerra perdida: ya tienen ficha clínica, POS, inventario, app móvil y años
de ventaja.

Pero hay un hueco real: **el no-show**, y **el rescate del cupo perdido**.

Los datos son consistentes en la literatura médica y en la industria:

| Escenario | Tasa de inasistencia |
|---|---|
| Sin recordatorio | **23,1 %** |
| Con recordatorio automático | **17,3 %** |
| Con llamada de una persona | **13,6 %** |

Los sistemas de recordatorio automático reducen el no-show entre un **28 % y un 60 %**
según el estudio y el número de canales. Y un dato que casi nadie explota: **agregar un
segundo toque diario sobre el recordatorio semanal sube la tasa de confirmación un 26 %
adicional**, y la *redacción* del mensaje mueve la aguja por sí sola (14,2 % vs 21,1 % de
no-show entre dos versiones del mismo recordatorio).

Es decir: **el copy y la cadencia de los mensajes son el producto**, no un detalle de
implementación.

## 2. La economía que hay que poner en el pitch

Ejemplo conservador de una clínica pequeña (supuestos explícitos, ajustar por vertical):

```
400 citas agendadas/mes · ticket promedio $35 · no-show 20 %
→ 80 citas perdidas/mes = $2.800 de ingreso evaporado

Con SuperConfirma (reducción conservadora del 40 %):
→ no-show baja a 12 % = 48 citas perdidas = $1.680
→ ahorro directo: $1.120/mes

+ Rescate de cupo (30 % de los huecos liberados se revenden a lista de espera):
→ ~14 citas × $35 = $490/mes extra

IMPACTO TOTAL ≈ $1.610/mes
COSTO DEL SOFTWARE: $59/mes  →  ROI ≈ 27×
COSTO VARIABLE DE MENSAJES: ~$12/mes (3 mensajes × 400 citas × ~$0,01)
```

Esta tabla es la **venta entera**. El panel del producto debe mostrarla en vivo con los
datos reales del negocio ("este mes recuperaste $1.430"). Ver
[06 - Diferenciadores](06-diferenciadores.md).

## 3. Alerta urgente: WhatsApp cambia de precio el 1 de octubre de 2026

Faltan **dos semanas**. Meta pasa a cobrar por mensaje:

- Las **plantillas de utilidad** (confirmaciones y recordatorios) pasan a cobrarse
  **también dentro** de la ventana de servicio de 24 h, que hasta el 30-sep-2026 eran gratis.
- Los **mensajes de servicio** (respuestas libres dentro de la ventana) también se cobran,
  con un **tier gratuito de 1.000 mensajes/mes por número de teléfono de negocio**.

Dos consecuencias de arquitectura que hay que decidir **antes** de escribir código:

1. **Medición de costo por tenant desde el día 1.** Cada mensaje enviado debe registrarse
   con categoría, país, costo estimado y a qué reserva pertenece. Sin esto el margen se
   evapora en silencio y no puedes facturar excedentes.
2. **Un número de WhatsApp por negocio, no un número compartido.** El tier gratuito de
   1.000 mensajes de servicio es *por número*. Con un número compartido, 20 clientes se
   comen el tier en días; con número propio, cada negocio trae su propio tier — y además el
   cliente final ve el número de *su* negocio, no el tuyo (mejor conversión, mejor
   reputación, y el riesgo de bloqueo queda aislado por cliente). El costo es más fricción
   en el onboarding. **Es una decisión abierta.**

Detalle en [02 - WhatsApp y notificaciones](02-whatsapp-y-notificaciones.md).

## 4. Restaurante y clínica NO son el mismo producto

| | Clínica / servicios | Restaurante |
|---|---|---|
| Recurso | Profesional (capacidad 1) | Mesa (capacidad N, combinable) |
| Unidad reservada | Cita con duración fija | "Cover" (comensales) en un turno |
| Disponibilidad | Horario del profesional + buffers | Turnos (almuerzo/cena) + rotación de mesa |
| Cancelación | Se libera un slot exacto | Se libera capacidad, se recombina |
| Extra | Ficha clínica (dato sensible), especialidades | Walk-ins, lista de espera presencial, plano de salón |
| Complejidad de asignación | Baja | **Alta** (bin-packing de mesas) |

Existe una abstracción que cubre a las dos (ver
[03 - Modelo de dominio](03-modelo-de-dominio.md)): *reservar N unidades de capacidad sobre
uno o más recursos, en una ventana de tiempo*. Pero la **asignación automática de mesas** de
un restaurante es un problema de optimización que no se resuelve en un MVP.

**Recomendación: arrancar por el modelo "cita con profesional"** (consultorios, odontología,
estética, barbería, veterinaria, fisioterapia, talleres, asesorías, notarías). Un solo
modelo mental, capacidad 1, y cubre la mayoría del mercado direccionable. Restaurantes en
la fase 2, con el modelo de mesas hecho en serio.

## 5. Stack: recomendación con matices

| Capa | Recomendación | Por qué |
|---|---|---|
| Panel de administración | **Angular + Tailwind** ✅ | Es lo que ya sabes. Es una app privada: el bundle no afecta SEO ni conversión. |
| Widget público de reserva | **NO Angular** ⚠️ | Va incrustado en landings de clientes. El peso del bundle golpea el LCP y la conversión. Preact/Svelte/vanilla (<30 KB) o Astro. |
| Base de datos + Auth | **Supabase (Postgres)** ✅ | RLS, Auth, Storage, `pg_cron`, `pgmq`, Edge Functions. Ahorra meses. |
| API pública / motor | **API propia (BFF) delante de Supabase** ⚠️ | **Nunca expongas PostgREST al widget público.** El flujo de reserva es anónimo y necesita lógica de negocio, rate limiting y anti-abuso. |
| Mensajería | WhatsApp **Cloud API directo** de Meta, detrás de una interfaz `MessagingProvider` | Cero markup. 360dialog (~€49/mes flat) recién conviene sobre ~10.000 msg/mes. Twilio cobra +$0,005/msg. |
| Jobs y colas | `pg_cron` + `pgmq` (Supabase) | Recordatorios programados, reintentos de webhook, cola de mensajes. Sin infra extra. |

El punto crítico: **anti double-booking en la base de datos, no en el código de
aplicación**. PostgreSQL lo resuelve de forma definitiva con `EXCLUDE USING gist` sobre
`tstzrange`: hace *físicamente imposible* solapar reservas, sin locks ni race conditions.
Detalle en [04 - Stack y arquitectura](04-stack-y-arquitectura.md).

## 6. Lo original (lo que no tiene nadie)

Ordenado por defendibilidad — desarrollo completo en
[06 - Diferenciadores](06-diferenciadores.md):

1. 🥇 **Red de reputación de asistencia (Confirm Score)** — puntaje de riesgo de no-show por
   teléfono, agregado entre *todos* los negocios de la red. Cada cliente nuevo mejora el
   producto para todos: efecto de red real, imposible de copiar sin volumen. **Este es el foso.**
2. 🥈 **Depósito dinámico según riesgo** — solo se pide anticipo si el score lo amerita o si
   es un horario premium. Monetiza el score y no castiga al cliente bueno con fricción.
3. 🥉 **Rescate de cupo automático** — al cancelar, se lanza una "carrera" por WhatsApp a la
   lista de espera; el primero que confirma se lleva el cupo, con retención temporal de
   10 min. Convierte cancelaciones en ingreso. **Esta feature paga la suscripción sola.**
4. **Escalera de confirmación multicanal** — WhatsApp → reintento → SMS → llamada con voz IA
   → alerta a recepción. Los competidores mandan un recordatorio y se rinden.
5. **Overbooking calibrado** — sobreagendar un % basado en el histórico real de *ese*
   profesional en *ese* horario, con tope de riesgo. Como las aerolíneas.
6. **Modo Agencia / white-label real** — administrar N negocios desde un panel, con marca y
   precio propios. Es tu caso de uso *y* tu canal de distribución. Casi nadie lo tiene bien.
7. **Panel "Dinero Recuperado"** — la métrica estrella del producto, visible al entrar.
   Hace obvia la renovación.

## 7. Riesgos principales

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Bloqueo o degradación del número de WhatsApp por reportes | 🔴 Crítico | Opt-in explícito, plantillas de utilidad (no marketing), rate limits, monitoreo de calidad, número por tenant |
| Cambio de precios de Meta (1-oct-2026 y futuros) | 🔴 Alto | Metering por tenant desde el día 1, planes con excedente facturable, capa `MessagingProvider` intercambiable |
| Complejidad de restaurantes subestimada | 🟠 Medio | No meterlos en el MVP; fase 2 con modelo de mesas propio |
| Competidores establecidos (AgendaPro, Reservo) | 🟠 Medio | No competir en "suite completa"; ganar en confirmación + embebido + agencia |
| Datos de salud bajo LOPDP | 🟠 Medio | No guardar historia clínica en el MVP; solo contacto y motivo de cita |
| RLS mal configurada = fuga entre tenants | 🔴 Crítico | `tenant_id` en todas las tablas, claims en el JWT (no subqueries), tests de aislamiento automatizados |

## 8. Recomendación de camino

```
Fase 0 (1-2 sem)  Decisiones abiertas + constitution + spec del MVP
Fase 1 (4-6 sem)  MVP: agenda de profesional + página pública + widget embebido
                  + confirmación por WhatsApp + panel básico
Fase 2 (3-4 sem)  Rescate de cupo + lista de espera + webhooks + API pública
Fase 3 (3-4 sem)  Confirm Score + depósitos dinámicos + modo agencia
Fase 4            Restaurantes (mesas, turnos, walk-ins)
```

👉 Continuar en [Decisiones abiertas](../decisiones-abiertas.md).

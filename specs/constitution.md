# Constitución de SuperConfirma

Principios no negociables. Toda spec, plan y tarea se evalúa contra este documento. Si algo
lo contradice, se corrige el código — no el principio. Cambiar un principio requiere una
decisión explícita registrada aquí, con fecha y motivo.

_Versión 1.0 · 14 de septiembre de 2026_

---

## Contexto fijado

| Decisión | Valor | Doc |
|---|---|---|
| Rubros del MVP | **Citas con profesional** primero, restaurantes en v2, sobre un núcleo único | D-01 |
| Mercado inicial | **Ecuador** — USD, sin horario de verano, LOPDP | D-02 |
| WhatsApp | **Número propio por negocio** vía Embedded Signup | D-03 |
| Operación | **Servicio gestionado**, con arquitectura de autoservicio desde el día 1 | D-04 |

---

## P1 · El aislamiento entre negocios se prueba, no se supone

Cada fila de dato de negocio lleva `tenant_id`. RLS activada en toda tabla alcanzable por
`anon` o `authenticated`. El tenant viaja en claims del JWT, nunca en subqueries por fila.

**Cómo se verifica:** una suite de tests de aislamiento corre en CI y, con credenciales del
negocio A, intenta leer, escribir, actualizar y borrar datos del negocio B en **toda** tabla.
Una tabla nueva sin su test de aislamiento no entra a `main`.

> Vendemos a clínicas. Una fuga entre tenants no es un bug: es el fin del producto.

## P2 · Las invariantes viven en la base de datos

Si una regla no puede violarse jamás, se expresa como restricción de Postgres, no como un
`if` en la aplicación.

- Dos reservas no pueden solapar en el mismo recurso → `EXCLUDE USING gist`, con índice
  parcial sobre los estados que realmente bloquean.
- Un mensaje no puede enviarse dos veces para la misma reserva, tipo y ventana → índice
  único en `message_log`.
- La capacidad de un turno no puede superarse → restricción verificada en transacción.

**Cómo se verifica:** existe un test que intenta violar cada invariante saltándose la capa
de aplicación (SQL directo) y espera que la base lo rechace.

## P3 · Ningún cliente recibe dos veces el mismo mensaje

Todo envío es idempotente por construcción: clave `(booking_id, tipo, ventana)` registrada
antes de enviar. Un reintento por fallo de red nunca produce un segundo WhatsApp.

> El peor fallo posible de este producto no es perder una reserva: es mandarle siete
> mensajes a un paciente. Eso destruye la confianza del negocio y la calidad del número.

## P4 · El widget público nunca toca la base de datos directamente

Todo lo público pasa por la API propia, que valida, limita por tasa y aplica la lógica de
negocio. La clave `anon` de Supabase no se publica en ningún bundle de cliente.

## P5 · Cada mensaje tiene un costo y se mide siempre

Ningún mensaje sale sin registrar categoría, país, costo estimado, tenant y reserva
asociada. El costo por negocio es consultable en cualquier momento.

> Meta cambia precios. La única defensa es saber, siempre, cuánto cuesta cada cliente.

## P6 · Sin consentimiento no hay mensaje

Antes del primer envío a un teléfono debe existir un registro de consentimiento con el
texto exacto mostrado, fecha, origen y versión de los términos. La baja se respeta de forma
inmediata y **global a toda la red**, no por negocio.

## P7 · Nunca PII en logs ni en mensajes de error

Teléfonos, nombres, correos y motivos de consulta van enmascarados en todo log, traza y
reporte de error. El nombre del servicio no se incluye por defecto en los mensajes
salientes: "tienes una cita", no "tu consulta de X".

## P8 · El dominio es puro y testeable sin infraestructura

El cálculo de disponibilidad, la máquina de estados de la reserva y las reglas de la
escalera de confirmación viven en `packages/core` como funciones puras, sin base de datos,
sin HTTP y sin reloj implícito (el tiempo se inyecta).

**Cómo se verifica:** `packages/core` no declara dependencias de I/O y sus tests corren sin
levantar nada.

## P9 · El tiempo siempre lleva zona

Todo instante se guarda como `timestamptz`. Toda regla de disponibilidad se expresa en hora
local del `location` y se materializa a UTC en el momento de calcular. Ninguna función de
dominio usa `now()` implícito.

Ecuador no tiene horario de verano, pero el motor **no asume eso**: se diseña para DST
porque el segundo país sí lo tendrá.

## P10 · Los datos del negocio son del negocio

Exportación completa en CSV y webhooks firmados disponibles **desde el plan más barato**.
Sin permanencia, sin costo de salida, sin funciones de retención artificial.

> Es la queja número uno contra la competencia. Es gratis cumplirla si se diseña desde el
> inicio, y carísimo agregarla después.

## P11 · El cliente final nunca necesita una cuenta

Reservar, confirmar, reprogramar y cancelar se hacen sin registro, sin contraseña y sin
app: enlace firmado de un solo uso o botón de WhatsApp. Cada paso adicional cuesta
conversión.

## P12 · La agenda funciona aunque WhatsApp no

Un negocio recién dado de alta puede operar su agenda mientras espera la aprobación de Meta.
El canal se degrada con elegancia: WhatsApp → email → aviso en el panel para llamar. Ninguna
función central depende de que un proveedor externo esté disponible.

## P13 · Un solo núcleo para todos los rubros

No hay "módulo clínica" y "módulo restaurante". Hay recursos con capacidad, servicios con
duración y reglas de disponibilidad. Las diferencias de rubro son **configuración y
presentación**, nunca ramas paralelas del dominio.

**Cómo se verifica:** si una función del core recibe un parámetro `tipoDeNegocio` para
decidir lógica, el modelo está mal y se corrige el modelo.

## P14 · Spec antes que código

Ninguna funcionalidad se implementa sin una spec con criterios de aceptación verificables
en `specs/NNN-nombre/spec.md`. El orden es spec → plan → tasks → implementación. Un cambio
de alcance se refleja primero en la spec.

---

## Cómo se decide cuando hay conflicto

1. **Seguridad y privacidad** (P1, P6, P7) ganan siempre.
2. **Corrección de datos** (P2, P3, P9) gana sobre velocidad de entrega.
3. **Conversión del cliente final** (P11) gana sobre comodidad del panel.
4. **Simplicidad del núcleo** (P13) gana sobre cubrir un caso raro de un rubro.

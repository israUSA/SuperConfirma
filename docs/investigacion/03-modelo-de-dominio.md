# 03 · Modelo de dominio

> Objetivo: una sola abstracción que sirva a clínica, barbería, cancha, salón y —en fase
> 2— restaurante, sin bifurcar el producto en dos códigos distintos.

## 1. La abstracción central

> **Una reserva ocupa N unidades de capacidad sobre uno o más recursos, durante una
> ventana de tiempo.**

De ahí sale todo:

| Vertical | Recurso | Capacidad | Unidades que ocupa una reserva |
|---|---|---|---|
| Consultorio | Dr. Pérez | 1 | 1 |
| Barbería | Silla 2 / Juan | 1 | 1 |
| Clase grupal / taller | Sala A | 12 | 1 por persona |
| Cancha de fútbol | Cancha 1 | 1 | 1 |
| Restaurante | Mesa 7 | 4 | 1 por comensal (y puede tomar 2 mesas) |
| Tour | Salida 10:00 | 20 | 1 por pasajero |

La única diferencia real entre verticales es **cómo se asignan los recursos**:

- **Capacidad 1** (clínica, barbería, cancha): el cliente elige el recurso o el sistema
  asigna cualquiera libre. Trivial.
- **Capacidad N compartida** (clases, tours): se resta del cupo. Fácil.
- **Combinación de recursos** (restaurante: unir mesas): problema de asignación. **Fase 2.**

## 2. Entidades

```
account            Cuenta comercial (quien paga). Puede ser una agencia.
└── business       Negocio / marca (clínica "Dental Sur")
    └── location   Sucursal: dirección, zona horaria, número de WhatsApp
        ├── resource        Profesional / mesa / cancha / sala (capacity, tipo)
        ├── service         Servicio / motivo (duración, buffers, precio, depósito)
        ├── availability_rule       Horario recurrente por recurso o por local
        ├── availability_exception  Feriado, vacaciones, bloqueo puntual
        ├── booking                 La reserva
        │   └── booking_resource    Qué recursos ocupa (N:M, permite mesas unidas)
        ├── waitlist_entry          Quién espera un cupo
        └── customer                Cliente del negocio
```

Transversales:

```
contact_identity   Teléfono normalizado E.164, global. Base del Confirm Score.
message_log        Cada mensaje enviado: canal, plantilla, costo, estado.
webhook_endpoint   Destinos de salida configurados por el negocio.
webhook_delivery   Cada intento de entrega, con reintentos.
api_key            Credencial de API por negocio.
audit_log          Quién hizo qué (requisito para vender a clínicas).
```

### Notas de diseño

- **`account` ≠ `business`**: separarlos desde el inicio es lo que habilita el
  **Modo Agencia** (una cuenta que administra 15 negocios) sin migración dolorosa después.
- **`location` lleva la zona horaria**, no el negocio: una cadena puede tener sucursales en
  husos distintos.
- **`service` define duración y buffers**, no el recurso. Una limpieza dental dura 30 min
  con cualquier odontólogo; si un profesional es más lento, se sobrescribe en
  `service_resource`.

## 3. Máquina de estados de la reserva

```
                  ┌──────────────── expira (10 min) ─────────────┐
                  ▼                                              │
   [hold] ──confirma datos──▶ [pending] ──cliente confirma──▶ [confirmed]
      │                          │                                │
      │                          │ no responde nunca              │ llega
      │                          ▼                                ▼
      │                    [unconfirmed]                      [arrived]
      │                          │                                │
      └──────────┐               │                                ▼
                 ▼               ▼                           [completed]
            [cancelled] ◀── cancela ────────┐
                 │                          │
                 │                    [no_show]  ◀── no llegó
                 ▼
          dispara RESCATE DE CUPO
```

| Estado | Ocupa el cupo | Significado |
|---|---|---|
| `hold` | ✅ Sí | Retención temporal mientras el cliente llena el formulario (10 min, expira sola) |
| `pending` | ✅ Sí | Reservada, aún no confirmada por el cliente |
| `confirmed` | ✅ Sí | El cliente confirmó explícitamente |
| `unconfirmed` | ✅ Sí | Pasó toda la escalera sin responder. **Candidata a rescate / overbooking** |
| `arrived` | ✅ Sí | Check-in |
| `completed` | ❌ No | Atendida |
| `cancelled` | ❌ No | Cancelada → libera cupo → dispara rescate |
| `no_show` | ❌ No | No llegó. **Alimenta el Confirm Score** |
| `rescheduled` | ❌ No | Reemplazada por otra reserva (`replaced_by_id`) |

> El estado `hold` es lo que evita el bug clásico: dos personas eligiendo el mismo horario
> al mismo tiempo en el widget. Se crea al seleccionar el horario, **antes** de pedir datos.

## 4. Anti double-booking: en la base, no en el código

PostgreSQL lo resuelve de raíz. Sin locks, sin transacciones a mano, sin race conditions:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE booking_resource (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  booking_id    uuid NOT NULL REFERENCES booking(id) ON DELETE CASCADE,
  resource_id   uuid NOT NULL REFERENCES resource(id),
  slot          tstzrange NOT NULL,
  units         int NOT NULL DEFAULT 1,
  blocking      boolean NOT NULL,   -- derivado del estado de la reserva

  CONSTRAINT no_overlap
    EXCLUDE USING gist (resource_id WITH =, slot WITH &&)
    WHERE (blocking)
);
```

Cuatro detalles que la mayoría se salta:

1. **`WHERE (blocking)`** — sin el índice parcial, una reserva cancelada sigue bloqueando
   el horario para siempre. Es el error más común con esta técnica.
2. **Rangos `[)`** (abierto a la derecha) — permite citas consecutivas 10:00–10:30 y
   10:30–11:00 sin falso conflicto. `tstzrange(a, b, '[)')`.
3. **Los buffers van dentro del rango**, no fuera. Si el servicio pide 10 min de limpieza
   después, el `slot` guardado es 10:00–10:40 aunque el cliente vea "10:00–10:30".
4. **Capacidad N no se cubre con `EXCLUDE`**. Para clases o mesas compartidas hace falta
   una restricción de suma de `units`, vía trigger con `SELECT ... FOR UPDATE` sobre la fila
   del recurso, o una tabla de contadores por slot. Diseñar ambos caminos desde el inicio.

## 5. Zonas horarias (la fuente de errores silenciosos)

Reglas duras:

- **Guardar siempre `timestamptz`** (UTC internamente). Nunca `timestamp` sin zona.
- **`location.timezone`** guarda el IANA (`America/Guayaquil`, `America/Santiago`).
- **Las reglas de disponibilidad se expresan en hora local** ("martes 09:00–13:00") y se
  materializan a UTC al generar slots.
- ⚠️ **Horario de verano**: Chile, México (parcial), Paraguay y Brasil (histórico) cambian
  de hora. Ecuador, Perú y Colombia no. Una regla "todos los martes 09:00" cae en un UTC
  distinto según la época del año. Si materializas slots a UTC por adelantado, hay que
  regenerarlos ante un cambio de huso.
- El cliente que reserva puede estar en otra zona (telemedicina): mostrar el horario en la
  zona del **local** y, si difiere, también en la del visitante.

## 6. Generación de disponibilidad

```
slots_disponibles(location, service, rango_fechas) =
      reglas de horario del recurso
    − excepciones (feriados, vacaciones, bloqueos)
    − reservas que bloquean (hold/pending/confirmed/unconfirmed/arrived)
    − buffers del servicio
    ∩ ventana de reserva permitida (mín. 2 h de anticipación, máx. 60 días)
    ∩ granularidad de la grilla (cada 15 / 20 / 30 min)
    + capacidad restante del recurso
```

Decisiones a tomar:

- **Grilla fija vs inicio libre.** Grilla fija (cada 15/30 min) es lo esperado en clínicas
  y mucho más simple. Recomendado para el MVP.
- **Calcular al vuelo vs materializar.** Al vuelo es correcto y evita desincronización;
  materializar es más rápido. Recomendación: **calcular al vuelo con caché corta (30-60 s)**
  por `(location, service, día)`. Invalidar al crear/cancelar reserva.
- **Modo turno** (restaurantes, clases): en vez de slots, ventanas con capacidad
  ("cena 19:00–23:00, 60 cubiertos"). Mismo modelo, `availability_rule.mode = 'shift'`.

## 7. Identidad del cliente

Dos niveles, y la distinción importa mucho:

| | `customer` | `contact_identity` |
|---|---|---|
| Alcance | Por negocio | **Global, toda la red** |
| Contiene | Nombre, notas, historial en *ese* negocio | Teléfono E.164 normalizado, hash |
| Para qué | Ficha del negocio | **Confirm Score**, deduplicación, lista global de bajas |
| Visibilidad | Solo su negocio | Nunca se expone crudo entre negocios |

> ⚠️ **Privacidad:** entre negocios se comparte **el score derivado, nunca el historial
> crudo**. El negocio B jamás ve que el cliente faltó al negocio A. Ver
> [07 - Negocio, precios y legal](07-negocio-precios-legal.md).

Normalización de teléfono: E.164 obligatorio, con prefijo de país inferido del `location`.
Guardar también `phone_hash` (SHA-256 con pepper) para búsquedas cruzadas sin exponer el número.

## 8. Lo que el MVP NO debe modelar

Poner límites explícitos evita que el proyecto se vuelva infinito:

- ❌ Historia clínica / expediente médico (riesgo legal alto, valor bajo en fase 1)
- ❌ Facturación electrónica / SRI
- ❌ Inventario, POS, caja
- ❌ Nómina y comisiones de profesionales
- ❌ Plano de salón y asignación automática de mesas (fase 4)
- ❌ App móvil nativa (la web responsive alcanza)

Todo esto se conecta **por webhook y API** al sistema que el negocio ya tiene. Esa es la
postura: *SuperConfirma no reemplaza tu sistema, lo alimenta.*

---

## Fuentes

- [Simple Talk — PostgreSQL range overlap, GiST y EXCLUDE](https://www.red-gate.com/simple-talk/databases/postgresql/overlapping-ranges-in-subsets-in-postgresql/)
- [Cybertec — Exclusion constraints in PostgreSQL and a tricky problem](https://www.cybertec-postgresql.com/en/exclusion-constraints-in-postgresql-and-a-tricky-problem/)
- [jusDB — Range types y exclusion constraints para evitar double-booking](https://www.jusdb.com/blog/postgresql-range-types-exclusion-constraints)
- [boringSQL — Beyond start and end columns](https://boringsql.com/posts/beyond-start-end-columns/)

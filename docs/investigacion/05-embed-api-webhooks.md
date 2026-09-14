# 05 · Embed, API y webhooks

> Responde a dos preguntas del brief: *"¿cómo se pone la agenda en una página web?"* y
> *"¿cómo llevo los agendamientos de una empresa a otra plataforma?"*

---

# Parte A · Cómo se pone en una página web

Cuatro modos, y hay que soportar los cuatro porque cubren clientes distintos.

## A.1 Link directo (el más simple)

```
https://reservas.superconfirma.com/dental-sur
https://dentalsur.com/reservar   (dominio propio del cliente, vía CNAME)
```

Sirve para: biografía de Instagram, botón de WhatsApp, código QR en recepción, Google
Business Profile, firma de correo, campañas de pago.

Debe funcionar **perfecto en móvil** — la mayoría de las reservas llegan desde el celular.

## A.2 Página pública hospedada (SEO)

Una página por negocio, renderizada en servidor, con:

- `JSON-LD` de schema.org (`LocalBusiness`, `Service`, `OpeningHoursSpecification`)
  generado automáticamente desde los datos del negocio.
- Metadatos Open Graph para que se vea bien al compartir por WhatsApp.
- Sitemap y URLs limpias.
- Dominio propio del cliente por CNAME (para que no parezca "de terceros").

> 💡 **Ángulo de venta para tu negocio de landing pages:** "tu agenda también posiciona en
> Google". Ningún competidor SMB lo vende así.

### Reserve with Google

Google permite poner un botón de **Reservar** en el perfil de Google Business, pero
**solo a través de un proveedor de agendamiento con integración oficial**. El negocio debe
tener ubicación física verificada y una categoría elegible (gastronomía, actividades,
belleza, fitness, servicios del hogar, servicios financieros).

📌 **Realista:** ser proveedor oficial de Reserve with Google es una gestión con Google,
no una integración técnica rápida. **No es para el MVP**, pero sí es un objetivo de
mediano plazo con alto valor comercial. Mientras tanto, el negocio puede poner su link de
SuperConfirma como "enlace de citas" en su perfil, que ya es un canal real.

## A.3 Widget embebido (el producto estrella)

Una línea en cualquier web — WordPress, Webflow, Wix, HTML plano, React, Angular:

```html
<div data-superconfirma="dental-sur" data-service="limpieza"></div>
<script src="https://cdn.superconfirma.com/embed.js" async></script>
```

### Por qué **iframe + script loader** y no web component

| Enfoque | Aislamiento CSS | Seguridad | Compatibilidad | Veredicto |
|---|---|---|---|---|
| `<iframe>` pelado | 🟢 Total | 🟢 Alta | 🟢 Universal | Funciona, pero altura fija y UX pobre |
| **Script loader que crea el iframe** | 🟢 Total | 🟢 Alta | 🟢 Universal | ✅ **Recomendado** |
| Web component (Shadow DOM) | 🟠 Bueno | 🟠 Comparte origen | 🟠 Fuga de estilos heredados | Tentador, pero frágil en webs ajenas |
| Inyección directa en el DOM | 🔴 Nula | 🔴 Baja | 🔴 Rompe con el CSS del host | ❌ No |

El script loader (~3 KB) hace tres cosas:

1. Crea el iframe apuntando a `booking.superconfirma.com/embed/<slug>` con los parámetros.
2. Escucha `postMessage` para **auto-ajustar la altura** según el paso del formulario.
3. Expone eventos al sitio anfitrión para analítica del cliente:
   `superconfirma:opened`, `:step`, `:booked`, `:error`.

Ese último punto importa: el dueño de la landing quiere disparar su píxel de conversión de
Meta/Google Ads cuando alguien reserva. Que el widget emita ese evento es un detalle
pequeño con impacto enorme en la venta.

### Modalidades del mismo widget

- **Inline** — incrustado dentro de una sección de la landing.
- **Modal** — se abre al pulsar cualquier botón: `<button data-superconfirma-open="...">`.
- **Botón flotante** — burbuja fija en la esquina.

### Detalles técnicos que hay que resolver desde el diseño

- **CSP**: documentar los dominios a permitir (`script-src`, `frame-src`, `connect-src`)
  para clientes con políticas estrictas.
- **Sin cookies de terceros**: Chrome las restringe, así que el estado del iframe no puede
  depender de ellas. El flujo debe ser stateless o guardar estado en el propio origen del
  iframe.
- **Accesibilidad**: navegación con teclado, foco atrapado en el modal, `aria-live` para
  los pasos. Es una compra frecuente en el sector salud y hay clientes que lo exigen.
- **Idioma y moneda** heredados del `location`.
- **Lista blanca de dominios** por negocio: el widget solo carga desde los dominios
  autorizados. Evita que alguien clone tu formulario en otro sitio.

## A.4 API headless (tu caso de uso real)

Para cuando diseñas la landing a medida y quieres tu propio formulario:

```http
GET  /public/v1/locations/{slug}/services
GET  /public/v1/availability?service=X&from=2026-09-20&to=2026-09-27
POST /public/v1/holds            → retiene el horario 10 min
POST /public/v1/bookings         → confirma con datos del cliente
GET  /public/v1/bookings/{token} → página "mi reserva" sin login
```

Clave pública por dominio (no secreta, con restricción de origen) + rate limiting por IP
y por dominio. Así vendes landings totalmente a medida con la agenda por debajo, y el
cliente ni se entera de que hay un SaaS detrás.

---

# Parte B · Cómo salen los datos hacia otras plataformas

Este es el punto donde puedes ser claramente mejor que la competencia, porque la queja #1
de los usuarios de software de agendamiento es *"la integración no funciona como
prometieron"*.

## B.1 Webhooks salientes

Seguir el estándar **Standard Webhooks** (impulsado por Svix con Zapier, Twilio, Supabase
y otros) en vez de inventar un formato propio. Tres cabeceras:

```http
POST https://crm-del-cliente.com/hooks/superconfirma
webhook-id: msg_2xK9...
webhook-timestamp: 1789234567
webhook-signature: v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=
content-type: application/json
```

```jsonc
{
  "id": "evt_01J8...",
  "type": "booking.confirmed",
  "created_at": "2026-09-14T18:22:31Z",
  "business_id": "biz_...",
  "location_id": "loc_...",
  "data": {
    "booking": {
      "id": "bkg_...",
      "status": "confirmed",
      "starts_at": "2026-09-20T14:00:00Z",
      "ends_at": "2026-09-20T14:30:00Z",
      "timezone": "America/Guayaquil",
      "service": { "id": "svc_...", "name": "Limpieza dental" },
      "resource": { "id": "res_...", "name": "Dra. Pérez" },
      "customer": { "name": "María L.", "phone": "+5939...", "email": "..." },
      "source": "widget",
      "confirmed_at": "2026-09-19T14:03:11Z"
    }
  }
}
```

### Catálogo de eventos

| Evento | Cuándo |
|---|---|
| `booking.created` | Nueva reserva |
| `booking.confirmed` | El cliente confirmó |
| `booking.rescheduled` | Cambió de horario (incluye la reserva anterior) |
| `booking.cancelled` | Cancelada (con `cancelled_by`: cliente / negocio / sistema) |
| `booking.no_show` | Marcada como no asistió |
| `booking.completed` | Atendida |
| `booking.reminder_sent` | Se envió un recordatorio |
| `customer.created` | Cliente nuevo |
| `waitlist.joined` / `waitlist.promoted` | Lista de espera |
| `message.failed` | No se pudo entregar un mensaje |

### Reglas de entrega (lo que separa una integración seria de una de juguete)

1. **Firma HMAC-SHA256** sobre `id.timestamp.payload`, comparación en tiempo constante.
2. **`webhook-timestamp`** con ventana de tolerancia (5 min) contra ataques de repetición.
3. **Entrega *at-least-once*** → el receptor debe deduplicar por `webhook-id`. Documentarlo
   explícitamente.
4. **Reintentos con backoff exponencial + jitter**: 0s, 30s, 5m, 30m, 2h, 5h, 10h.
   Tras agotarlos → **DLQ** y aviso al negocio.
5. **Panel de entregas**: ver cada intento, el cuerpo enviado, la respuesta, y un botón de
   **reenviar**. Esto es lo que realmente compra un integrador.
6. **Endpoint de prueba** con evento de ejemplo, desde el panel.
7. **Timeout de 10 s** y tratamiento de 2xx como éxito.

## B.2 API REST de entrada

Con API key por negocio (`Authorization: Bearer sc_live_...`), permisos por ámbito
(`bookings:read`, `bookings:write`, `customers:read`), rate limiting por key y registro de
uso. Permite que el sistema del cliente **cree** reservas, no solo las reciba.

## B.3 Sincronización de calendario

Prioridad alta y bastante trabajo:

| Destino | Método | Dificultad |
|---|---|---|
| Google Calendar | API + OAuth + canales push | 🟠 Media |
| Outlook / Microsoft 365 | Microsoft Graph + suscripciones | 🟠 Media |
| Apple / genéricos | Feed `.ics` de solo lectura | 🟢 Baja |
| Archivo `.ics` adjunto | En el correo de confirmación | 🟢 Muy baja |

**Sincronización bidireccional** (que un evento personal en el calendario del profesional
bloquee su agenda) es la funcionalidad que más piden los profesionales independientes y la
más fácil de subestimar: hay que manejar tokens que expiran, renovación de canales push,
bucles de eco y conflictos. Planearla como épica propia, no como tarea.

Para el MVP: `.ics` adjunto + feed de solo lectura. Google bidireccional en fase 2.

## B.4 Automatización sin código

- **n8n** (muy popular en LatAm, self-hosted): publicar un nodo comunitario. Barato de
  hacer y da mucha visibilidad técnica.
- **Make / Zapier**: apps oficiales con triggers (`booking.created`, `booking.confirmed`) y
  acciones (crear reserva, cancelar).
- **Google Sheets**: sincronización de reservas a una hoja. Suena básico, pero es lo que
  el 80 % de los negocios pequeños realmente quiere.

## B.5 Postura pública: portabilidad como argumento de venta

> *"Tus reservas son tuyas. Exportación completa en CSV, webhooks en tiempo real y API
> abierta desde el primer plan. Sin permanencia."*

Es un ataque directo al dolor de los competidores (contratos largos, exportación limitada,
integraciones cerradas) y cuesta poco implementarlo bien desde el inicio.

---

## Fuentes

- [Standard Webhooks (Svix y partners) — headers y firma](https://www.opsecforge.com/blog/webhook-signature-validation-hmac-sha256-best-practices-2026)
- [Didit — Webhook security: HMAC, retries, idempotency](https://didit.me/blog/webhook-security-patterns/)
- [BoldSign — Webhook best practices: idempotency and event ordering](https://boldsign.com/blogs/webhook-best-practices-retries-idempotency/)
- [Embeddy — Qué son los widgets embebibles (iframe vs script vs web component)](https://www.embeddy.ai/blog/what-are-embeddable-widgets)
- [Databrain — Embedded analytics en Angular: iframe vs SDK vs web components](https://www.usedatabrain.com/blog/embedded-analytics-angular)
- [Google Business Profile Help — Configurar reservas mediante un proveedor](https://support.google.com/business/answer/7475773?hl=en)
- [BrightLocal — Managing bookings with Google Business Profile](https://www.brightlocal.com/learn/google-business-profile-bookings-and-appointments/)
- [Partoo — Guía de Reserve with Google](https://www.partoo.co/en/blog/reserve-with-google/)

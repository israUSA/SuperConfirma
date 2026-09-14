# 02 · WhatsApp y notificaciones

> Este es el corazón del producto y su mayor riesgo operativo. Leer completo antes de
> diseñar nada.

## 1. Qué camino usar para enviar WhatsApp

| Opción | Costo extra | Riesgo | Veredicto |
|---|---|---|---|
| **Cloud API oficial de Meta** (directo) | Sin markup, solo tarifa de Meta | Bajo | ✅ **Empezar aquí** |
| **360dialog** (BSP) | ~€49/mes plano | Bajo | Conviene sobre ~10.000 msg/mes |
| **Twilio / Bird** | +$0,005 por mensaje | Bajo | Solo si ya usas Twilio para SMS |
| **Gupshup / Telnyx** | +$0,001 – $0,004 | Bajo | Alternativa por volumen |
| **Wati / Chatapi / plataformas "todo en uno"** | Alto | Medio | Son productos finales, no infraestructura. No sirven de base para un SaaS |
| ❌ **APIs no oficiales** (Baileys, WPPConnect, whapi, "WhatsApp Web automatizado") | Barato | 🔴 **Crítico** | **NO.** Viola los ToS de Meta, el número del cliente se bloquea sin aviso, y estarías vendiendo un producto que se puede caer de un día para otro. Inviable para un SaaS que quieres vender. |

**Decisión técnica:** implementar contra una interfaz `MessagingProvider` con
`WhatsAppCloudProvider` como primera implementación. Cambiar de BSP después es entonces
un archivo, no una refactorización.

```ts
interface MessagingProvider {
  sendTemplate(to: E164, template: TemplateRef, vars: Vars): Promise<SendResult>;
  sendFreeform(to: E164, body: string): Promise<SendResult>;   // solo dentro de ventana 24h
  parseInboundWebhook(req: Request): InboundEvent[];
  estimateCost(category: Category, country: ISO2): Money;
}
```

## 2. Precios: lo que cambia el 1 de octubre de 2026

Meta migró a **precio por mensaje** el 1-jul-2025 (antes era por conversación de 24 h).
Ahora viene el segundo golpe:

| Hasta el 30-sep-2026 | Desde el 1-oct-2026 |
|---|---|
| Plantillas de **utilidad** gratis dentro de la ventana de servicio de 24 h | Se cobran **siempre** |
| Mensajes de **servicio** (respuestas libres en la ventana) gratis | Se cobran, con **1.000 gratis/mes por número de negocio** |
| — | La tarifa de servicio iguala a la de utilidad/autenticación, por país |

**Órdenes de magnitud** (verificar siempre contra el rate card oficial vigente):

| País | Utilidad aprox. |
|---|---|
| Colombia | ~$0,0008 |
| México | ~$0,0115 |
| Alemania (referencia alta) | ~$0,0550 |

Hay **descuentos por volumen** para utilidad y autenticación, calculados por país y
categoría por separado.

> ⚠️ Las tarifas exactas de Ecuador/Perú no están en fuentes secundarias fiables.
> **Acción pendiente:** descargar el rate card oficial desde el WhatsApp Manager de la
> cuenta de Meta Business antes de fijar precios de venta.

### Consecuencias de producto

1. **Metering desde el día 1.** Tabla `message_log` con: `tenant_id`, `booking_id`,
   `category`, `country`, `provider_message_id`, `cost_estimate`, `status`, `billing_period`.
   Sin esto no puedes facturar excedentes ni detectar un tenant que te está comiendo el margen.
2. **Cada plantilla enviada cuesta.** Un flujo de 5 mensajes por reserva no es "gratis
   porque es WhatsApp". Diseñar la cadencia mirando el costo.
3. **El tier de 1.000 servicios/mes es por número** → fuerte argumento para
   *número propio por negocio*.
4. **Aprovechar la ventana de 24 h**: si el cliente responde "Confirmo", se abre la ventana
   y durante 24 h puedes conversar con mensajes de servicio (más baratos que plantillas, y
   los primeros 1.000/mes gratis). Diseñar los flujos para que el cliente responda temprano.

## 3. Onboarding de un negocio (la fricción real)

Para que un negocio pueda enviar por Cloud API hace falta:

1. Cuenta de **Meta Business** (verificación de negocio: documentos legales, puede tardar días).
2. **WABA** (WhatsApp Business Account).
3. Un **número de teléfono** que no esté en uso en la app normal de WhatsApp.
4. **Display name** aprobado por Meta.
5. **Plantillas aprobadas** (24–48 h típicamente; pueden rechazarse).

Esto es **días, no minutos**. Dos estrategias:

| Estrategia | Onboarding | Tier gratis | Riesgo de bloqueo | Marca |
|---|---|---|---|---|
| **Número compartido de SuperConfirma** | Instantáneo ⚡ | Compartido (se agota) | 🔴 Un cliente con spam tumba a todos | Se ve "SuperConfirma", no el negocio |
| **Número propio por negocio** | Días 🐢 | 1.000/mes cada uno | 🟢 Aislado | Se ve el negocio ✅ |
| **Híbrido** (recomendado) | Instantáneo + migración | Lo mejor de ambos | Controlado | Mejora al migrar |

**Recomendación: híbrido.** Arrancar con número compartido para que el cliente vea valor
el mismo día (prueba/plan básico), y ofrecer "conecta tu propio número" como upgrade —
usando **Embedded Signup** de Meta, que permite que el cliente conecte su WABA desde tu
panel sin salir de tu producto.

## 4. Las plantillas que necesitas (mínimo viable)

Categoría **utility** en todas (nunca `marketing`: es más cara y con opt-out obligatorio).

| # | Plantilla | Momento | Botones |
|---|---|---|---|
| 1 | `booking_confirmed` | Al reservar | Ver detalle · Cancelar |
| 2 | `reminder_24h` | 24 h antes | ✅ Confirmar · 🔄 Reprogramar · ❌ Cancelar |
| 3 | `reminder_2h` | 2–3 h antes (solo si no confirmó) | ✅ Confirmar · ❌ Cancelar |
| 4 | `booking_cancelled` | Al cancelar | Reagendar |
| 5 | `slot_rescue` | Cupo liberado → lista de espera | 🙋 Lo quiero |
| 6 | `reschedule_link` | Tras pedir reprogramar | Elegir horario |
| 7 | `post_visit` | Después de la cita | (opcional: reseña / reagendar) |

### Ejemplo de copy (importa más de lo que parece)

El estudio A/B en entorno hospitalario mostró **14,2 % vs 21,1 %** de no-show entre dos
redacciones. La versión con carga emocional / de compromiso gana:

```
❌ Débil:  "Recordatorio: tiene una cita el 15/09 a las 10:00."

✅ Fuerte: "Hola María 👋 Te guardamos el turno de mañana martes 15 a las 10:00
           con la Dra. Pérez. Si no puedes venir, avísanos ahora y se lo damos
           a otro paciente que está esperando.

           [✅ Confirmo]  [🔄 Cambiar hora]  [❌ No puedo ir]"
```

Tres palancas: **compromiso** ("te guardamos"), **escasez social** ("otro paciente está
esperando") y **salida fácil** (cancelar es un botón, no una llamada incómoda).

> 💡 **Feature derivada:** A/B testing de plantillas por vertical, con la tasa de
> confirmación medida. Es un diferenciador real y nadie en el segmento SMB lo ofrece.

## 5. Botones y respuestas entrantes

Las plantillas admiten hasta 10 botones, de tipos **quick reply**, **visitar web** y
**llamar**. Al tocar un quick reply, Meta envía un webhook con `interactive.button.payload`
(en Twilio llega como `ButtonText`).

**Diseño del payload:** incrustar un token firmado, no un texto legible:

```
payload = "cfm:<booking_id_corto>:<hmac8>"
```

Así el webhook resuelve la acción sin ambigüedad aunque el cliente reenvíe el mensaje, y
no puedes ser suplantado escribiendo el texto a mano.

**También hay que parsear texto libre** ("si", "sí", "confirmo", "ok", "no puedo", "1").
Mucha gente escribe en vez de tocar el botón. Normalizar acentos y usar una lista de
sinónimos; si no hay match claro, escalar a la bandeja del negocio en lugar de adivinar.

## 6. WhatsApp Flows (agendar dentro del chat)

Un **Flow** es una mini-app multipantalla que abre dentro de WhatsApp, lanzada desde una
plantilla. Permite **agendar sin salir del chat**: elegir servicio → profesional → día →
hora → confirmar.

- ✅ Conversión altísima: cero fricción, cero navegador.
- ⚠️ Requiere endpoint de datos propio (Flow Data Endpoint) con cifrado propio de Meta.
- 📌 **Veredicto:** no para el MVP, pero **sí es un diferenciador fuerte de fase 3**.
  La mayoría de los competidores SMB solo mandan un link.

## 7. Calidad, límites y anti-bloqueo

Meta asigna una **calificación de calidad** por número y **límites de mensajería
escalonados** (1K → 10K → 100K → ilimitado destinatarios/24 h). Si los usuarios bloquean o
reportan, la calidad baja y el número puede quedar restringido o inhabilitado.

Reglas de diseño no negociables:

1. **Opt-in real y registrado.** Checkbox explícito en el formulario de reserva
   ("Acepto recibir confirmaciones por WhatsApp") con timestamp, IP y texto exacto guardados.
2. **Solo utility.** Nunca promociones desde el número transaccional.
3. **Frecuencia con techo.** Máximo N mensajes por reserva y por cliente/día. Configurable
   y con tope duro del sistema.
4. **Baja inmediata.** "Responde BAJA para no recibir más" y respetarlo para siempre,
   cruzando todos los tenants.
5. **Monitoreo de calidad** vía webhook de Meta, con alerta al panel y freno automático
   de envíos si la calidad cae a rojo.
6. **Aislamiento por tenant** para que un cliente irresponsable no arrastre a los demás.

## 8. Canales de respaldo (la escalera)

WhatsApp no siempre llega: número mal escrito, sin WhatsApp, o simplemente no lo lee.

```
T-24h  WhatsApp plantilla recordatorio
       └─ sin respuesta a las 3 h → reintento WhatsApp (variante de copy)
T-3h   └─ sigue sin respuesta → SMS
T-2h   └─ sigue sin respuesta → (plan alto) llamada con voz IA
T-1h   └─ sigue sin respuesta → alerta en el panel: "3 sin confirmar, llamar"
```

Cada escalón se activa por configuración del plan. El escalón humano final es importante:
la llamada de una persona sigue siendo el método más efectivo (13,6 % de no-show).

Proveedores de respaldo a evaluar: SMS local por país (en LatAm el SMS es caro y poco
fiable; priorizar WhatsApp), email (Resend/Postmark, casi gratis), voz IA (fase 3+).

## 9. Modelo de costo por reserva

```
Reserva típica = 3 mensajes salientes (confirmación + recordatorio 24h + confirmación de cambio)
                 + 1-2 entrantes (gratis para el negocio)

A ~$0,01/mensaje → $0,03 por reserva
400 reservas/mes → ~$12/mes de costo variable

Con plan de $59/mes:
  margen bruto ≈ 80 %  (antes de infra, que es marginal en Supabase)
```

**Regla de pricing:** incluir un bolsón de mensajes en cada plan (ej. 500 / 2.000 / 6.000)
y cobrar el excedente con margen. Esto te protege del cambio de tarifas de Meta y convierte
un costo variable en ingreso variable.

---

## Fuentes

- [Respond.io — WhatsApp API pricing 2026](https://respond.io/blog/whatsapp-business-api-pricing)
- [YCloud — WhatsApp API pricing update effective October 1, 2026](https://www.ycloud.com/blog/whatsapp-api-message-pricing-update-effective-october-1-2026)
- [SendPulse — WhatsApp service message pricing changes October 2026](https://sendpulse.com/blog/whatsapp-service-message-pricing)
- [PickyAssist — WhatsApp pricing changes Oct 1 2026](https://pickyassist.com/blog/whatsapp-pricing-changes-october-2026/)
- [EngageLab — WhatsApp Business API pricing guide 2026](https://www.engagelab.com/blog/whatsapp-business-api-pricing)
- [GetKanal — 12 BSPs compared 2026](https://getkanal.com/blog/whatsapp-business-api-providers-compared)
- [EZContact — WhatsApp BSP comparison 2026](https://ezcontact.ai/en/blog/whatsapp-bsp-comparison/)
- [Twilio — Using buttons in WhatsApp](https://www.twilio.com/docs/whatsapp/buttons)
- [EngageLab — WhatsApp Flows: use cases, setup & examples 2026](https://www.engagelab.com/blog/whatsapp-flows)
- [Gurusup — WhatsApp API message templates guide 2026](https://gurusup.com/blog/whatsapp-api-message-templates)
- [PMC — A/B testing of digital messaging cut hospital no-show rates](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7310733/)
- [Am J Medicine — Effectiveness of outpatient appointment reminder systems](https://www.amjmed.com/article/S0002-9343(10)00108-7/fulltext)
- [Dialog Health — 35+ appointment reminder statistics](https://www.dialoghealth.com/post/patient-appointment-reminder-statistics)

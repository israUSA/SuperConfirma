# 07 · Negocio, precios y legal

## 1. Estructura de precios propuesta

Regla de oro: **cobrar por local, no por usuario**. El precio por profesional escala
más rápido de lo que el cliente espera y es la queja más repetida contra los competidores.
Cobrar por local es más simple de entender y más honesto.

| | **Esencial** | **Pro** | **Agencia** |
|---|---|---|---|
| Precio | $29 /local/mes | $69 /local/mes | desde $19 /local/mes |
| Profesionales | Hasta 3 | Ilimitados | Ilimitados |
| Mensajes incluidos | 500/mes | 2.500/mes | según volumen |
| Página pública + widget | ✅ | ✅ | ✅ marca propia |
| Confirmación por WhatsApp | ✅ | ✅ | ✅ |
| Recordatorios | 1 nivel | Escalera completa | Escalera completa |
| Rescate de cupo | ❌ | ✅ | ✅ |
| Reagendamiento masivo | ❌ | ✅ | ✅ |
| Webhooks + API | ✅ *(portabilidad radical)* | ✅ | ✅ |
| Confirm Score | Solo lectura | ✅ + políticas | ✅ |
| Depósitos dinámicos | ❌ | ✅ | ✅ |
| Número de WhatsApp propio | Compartido | Propio | Propio |
| Multi-local / panel de cartera | ❌ | ✅ | ✅ |
| Marca blanca y dominio propio | ❌ | Parcial | ✅ Total |

**Excedente de mensajes:** $0,04 por mensaje sobre el bolsón incluido. Con un costo real
cercano a $0,01, deja margen y protege contra las subidas de tarifa de Meta.

### Por qué estos números

- $29 entra por debajo de AgendaPro ($19/usuario ⇒ un negocio con 3 profesionales paga
  $57) para un negocio pequeño típico.
- $69 se justifica solo con el rescate de cupo: si recupera 10 citas al mes a $35, son
  $350 contra $69.
- El plan Agencia con precio por volumen es lo que te permite empaquetarlo en las landings.

### Ingresos adicionales

| Fuente | Modelo |
|---|---|
| Implementación / configuración | $150–400 una vez (tu servicio actual) |
| Landing page + agenda (paquete) | Tu precio habitual + suscripción recurrente |
| Excedente de mensajes | $0,04/mensaje |
| Depósitos y anticipos | Comisión de la pasarela + 1 % de plataforma (opcional) |
| Llamadas con voz IA | Por minuto, plan alto |

> 💡 El valor real para ti está en el **recurrente**: vender una landing es un pago único;
> vender una landing con SuperConfirma es un pago único **más** $29–69/mes por cliente,
> para siempre. Con 30 clientes son $1.500–2.000/mes de ingreso pasivo.

## 2. Pagos y cobros

### Para cobrar la suscripción (tú a tus clientes)

**Stripe no opera en Ecuador** (situación a julio 2026). Alternativas locales:

| Pasarela | Comisión | Recurrente | Notas |
|---|---|---|---|
| **Kushki** | ~2,95 % + $0,25 | ✅ Sí, con tokenización | Tarifa publicada más baja, liquidación T+2/T+3 |
| **PayPhone** | 3,49 % + $0,30 | Parcial | Muy adoptada, pago móvil rápido, buena conversión local |
| **Datafast** | Por cotización | ✅ Cobros recurrentes y links de pago | El más tradicional/bancario |

**Recomendación:** Kushki como principal (recurrente + tokenización), PayPhone como
alternativa de conversión. Si en algún momento vendes fuera de Ecuador, agregar Stripe o
dLocal para el resto de LatAm.

### Para los anticipos de los clientes finales (⚠️ decisión importante)

Hay dos modelos y la diferencia es regulatoria, no técnica:

| Modelo | Cómo funciona | Riesgo |
|---|---|---|
| **A. Conectado** (recomendado) | El negocio conecta *su propia* cuenta de pasarela. El dinero va directo de su cliente a él. SuperConfirma solo orquesta. | 🟢 Bajo — no custodias fondos |
| **B. Agregado** | El dinero pasa por tu cuenta y tú lo liquidas al negocio | 🔴 Alto — te convierte en agregador de pagos, con regulación financiera, obligaciones de prevención de lavado y riesgo de contracargos |

**Elegir A.** El modelo agregado parece más elegante en producto, pero abre un frente
regulatorio que no quieres tener en el año 1.

## 3. Marco legal

### Protección de datos (Ecuador: LOPDP · y equivalentes regionales)

Estás tratando datos personales de terceros (los clientes de tus clientes). Tu rol es de
**encargado del tratamiento**; el negocio es el **responsable**. Eso exige:

1. **Contrato de encargo de tratamiento (DPA)** entre SuperConfirma y cada negocio, anexo
   a los términos de servicio.
2. **Aviso de privacidad** en la página de reserva, con finalidad explícita.
3. **Consentimiento registrado** para los mensajes de WhatsApp: texto exacto, marca de
   tiempo, IP y versión de los términos. Sin esto, cada envío es una infracción potencial
   y una denuncia a Meta esperando ocurrir.
4. **Derechos del titular**: acceso, rectificación, eliminación, oposición y portabilidad.
   Requiere un flujo operativo, no solo un párrafo legal.
5. **Política de retención**: borrar o anonimizar datos de reservas antiguas (ej. 24 meses).
6. **Registro de actividades de tratamiento** y notificación de brechas.

### Datos de salud = categoría especial

El nombre del servicio puede revelar información de salud ("consulta oncológica"). Por eso:

- ❌ El MVP **no guarda historia clínica**. Solo contacto, servicio y notas del negocio.
- ✅ Cifrado en reposo (Supabase lo da) y en tránsito.
- ✅ Los mensajes de WhatsApp **nunca** nombran el servicio sensible por defecto:
  "tienes una cita" en vez de "tu consulta de X". Configurable por el negocio.
- ✅ Registro de auditoría de quién accedió a qué.

### Confirm Score: el punto legalmente delicado

Compartir señales de comportamiento entre negocios es **elaboración de perfiles**. Es
viable, pero con condiciones:

- Base legal explícita e informada en el aviso de privacidad, desde el primer día.
- Solo se comparte el **puntaje derivado**, nunca el historial crudo ni el origen.
- Derecho de oposición real y visible.
- El score **sugiere fricción adicional, jamás niega el servicio de forma automática**.
- 📌 **Revisión con un abogado de protección de datos antes de activarlo.** Está en fase 3,
  hay tiempo, pero hay que diseñarlo desde ahora para no rehacerlo.

## 4. Ir al mercado

```
Mes 1-2   Producto usable + 3 clientes piloto (regalados, de tu cartera de landings)
          Objetivo: que funcione de verdad, no vender
Mes 3-4   10 negocios pagando. Precio bajo de "fundador" con precio congelado.
          Objetivo: aprender qué se rompe y qué piden
Mes 5-8   Paquete "landing + agenda" como oferta estándar de tu servicio
          + Modo Agencia abierto a otros freelancers/agencias
Mes 9-12  50-100 negocios → el Confirm Score empieza a tener sentido
          → activar depósitos dinámicos y planes altos
```

**Canales por orden de eficiencia:**

1. **Tu propia cartera de landing pages** — conversión altísima, costo cero.
2. **Otras agencias y freelancers** vía Modo Agencia — cada uno trae 5-20 negocios.
3. **Caso de estudio con números** ("esta clínica recuperó $1.400 en un mes") — es el
   material que vende solo en este nicho.
4. Contenido y SEO local ("cómo reducir inasistencias en tu consultorio").
5. Publicidad pagada — al final, cuando el retorno esté medido.

## 5. Métricas que hay que instrumentar desde el día 1

**Del producto (las que prueban tu tesis):**

- Tasa de no-show antes vs después, por negocio ← *la métrica que justifica todo*
- Tasa de confirmación por plantilla y por cadencia
- Cupos rescatados y dinero recuperado
- Tasa de entrega y lectura de WhatsApp
- Conversión del widget (visitas → reserva completada)

**Del negocio:**

- MRR, ARPU, churn mensual, LTV/CAC
- **Costo de mensajes por tenant** ← si esto se descontrola, el margen desaparece
- Tiempo desde el alta hasta la primera reserva real (activación)

---

## Fuentes

- [NM Tech Studio — Pasarelas de pago Ecuador 2026: PayPhone, Kushki y Datafast](https://www.nmtechstudio.com/blog/pasarelas-pago-ecuador-2026-comparativa)
- [BlueNova — Comparativa de pasarelas de pago en Ecuador](https://bluenova.com.ec/pasarelas-de-pago-en-ecuador-comparativa-completa-para-tiendas-online-2026/)
- [MN Desarrollo Web — Las 5 mejores pasarelas de pago en Ecuador 2026](https://mndesarrolloweb.com/pasarelas-pago-ecommerce-ecuador/)
- [Medesk — Reseña de AgendaPro 2026 (precios)](https://www.medesk.net/es/blog/agenda-pro-review/)
- [Clinera — Comparativa de software para clínicas LATAM 2026](https://www.clinera.io/mejor-software-clinicas)

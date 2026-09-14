# 06 · Diferenciadores — lo que no tiene nadie más

> Criterio: no basta con que sea "una función más". Cada idea se evalúa por **cuánto
> cuesta copiarla**. Una función se clona en un mes; un efecto de red, no.

## Mapa rápido

| # | Idea | Defendibilidad | Esfuerzo | Fase |
|---|---|---|---|---|
| 1 | 🥇 Confirm Score (red de reputación) | 🟢🟢🟢 Efecto de red | Alto | 3 |
| 2 | 🥈 Depósito dinámico según riesgo | 🟢🟢 Depende del #1 | Medio | 3 |
| 3 | 🥉 Rescate de cupo automático | 🟢🟢 Difícil de hacer bien | Medio | 2 |
| 4 | Reagendamiento masivo en un clic | 🟢🟢 Nadie lo automatiza | Medio | 2 |
| 5 | Escalera de confirmación + A/B de copy | 🟢 Datos acumulados | Medio | 2 |
| 6 | Overbooking calibrado | 🟢🟢 Requiere histórico | Medio | 3 |
| 7 | Modo Agencia / white-label real | 🟢🟢 Canal, no función | Medio | 1-2 |
| 8 | Panel "Dinero Recuperado" | 🟡 Copiable, pero vende | Bajo | 1 |
| 9 | Agendar dentro de WhatsApp (Flows) | 🟡 Barrera técnica | Alto | 3 |
| 10 | Portabilidad radical | 🟡 Es postura, no tecnología | Bajo | 1 |

---

## 1. 🥇 Confirm Score — red de reputación de asistencia

**El foso del producto.**

Un puntaje de riesgo de no-show asociado al **teléfono**, calculado con el comportamiento
agregado en **todos** los negocios de la red.

```
Cliente reserva con el teléfono +593 9XX XXX XXX
  └─ SuperConfirma consulta su identidad global
     ├─ 14 reservas previas en la red
     ├─ 11 asistió · 1 canceló con aviso · 2 no-show
     ├─ patrón: falla más los lunes temprano
     └─ Confirm Score: 62/100  (riesgo medio)
        └─ el sistema activa: recordatorio extra + pedir anticipo
```

### Por qué es defendible

- **Efecto de red puro:** cada negocio que entra hace el producto mejor para todos los
  demás. Con 500 negocios, el score es exacto; un competidor nuevo arranca con cero datos
  y no puede alcanzarlo con dinero ni con ingeniería.
- **Aumenta el costo de irse:** salir de SuperConfirma significa perder la visibilidad de
  riesgo de tus clientes.
- **Es la base de los diferenciadores #2 y #6**, que a su vez generan ingresos.

### Cómo se hace bien (y legal)

| ✅ Sí | ❌ No |
|---|---|
| Compartir un **score derivado** (0-100) y una banda de riesgo | Compartir el historial crudo entre negocios |
| Consentimiento en el formulario de reserva y aviso de privacidad claro | Que el negocio B vea "faltó donde el Dr. X" |
| Derecho de acceso, corrección y oposición | Listas negras punitivas o compartir nombres |
| Decaimiento temporal (un no-show de hace 2 años pesa poco) | Bloquear a alguien por el puntaje |
| El score **sugiere fricción**, no niega el servicio | Decisión automatizada sin revisión humana |

> ⚠️ Bajo la LOPDP ecuatoriana y regímenes equivalentes, esto es tratamiento de datos
> personales con elaboración de perfiles. Es viable con base legal y transparencia, pero
> **necesita revisión legal antes de lanzarse**. Ver
> [07 - Negocio, precios y legal](07-negocio-precios-legal.md).

### Arranque en frío

Con pocos datos el score no sirve. Solución: **score híbrido**.

```
Fase A (0-3 meses):   señales del propio negocio + señales del momento
                      (horario, anticipación, primera vez, servicio, canal)
Fase B (3-12 meses):  + historial dentro del negocio
Fase C (12+ meses):   + señal de red  ← aquí nace el foso
```

Las señales del momento ya predicen bastante sin ningún historial: reservas hechas con más
de 3 semanas de anticipación, primeras visitas, lunes temprano y horarios de mucha demanda
tienen tasas de no-show muy superiores.

---

## 2. 🥈 Depósito dinámico según riesgo

Los competidores ofrecen "pedir anticipo": **sí o no, para todos**. Eso ahuyenta a los
clientes buenos.

SuperConfirma decide por reserva:

| Situación | Acción |
|---|---|
| Score alto (buen historial), horario normal | Sin anticipo. Reserva en 2 toques. |
| Score bajo o primera vez, horario premium (viernes 19:00) | Anticipo de $10, descontable del servicio |
| Dos no-shows seguidos en este negocio | Anticipo obligatorio del 50 % |
| Cliente frecuente que ya vino 8 veces | Reserva directa, sin confirmación siquiera |

**Por qué funciona:** convierte el score en ingresos, reduce el no-show en el segmento que
importa, y elimina fricción donde no hace falta. El negocio configura la política; el
sistema la ejecuta reserva por reserva.

Requiere pasarela de pago (ver doc 07). En Ecuador: PayPhone, Kushki o Datafast — Stripe
no opera ahí.

---

## 3. 🥉 Rescate de cupo automático

**La feature que paga la suscripción sola.**

Hoy, cuando alguien cancela a las 4 de la tarde para el día siguiente, ese hueco se pierde.
La recepcionista no va a llamar a 12 personas.

```
17:04  Juan cancela su cita de mañana 10:00
17:04  El sistema busca candidatos:
         · lista de espera para ese servicio/profesional
         · clientes con cita más lejana que aceptarían adelantarla
         · ordenados por Confirm Score y afinidad de horario
17:05  Envía a los 5 mejores candidatos, simultáneo:
         "Se liberó un turno mañana 10:00 con la Dra. Pérez.
          ¿Lo quieres? Es para el primero que responda.  [🙋 Lo quiero]"
17:06  Ana responde primero → hold de 10 min → confirma
17:06  A los otros 4: "El turno ya fue tomado. Te avisamos del próximo."
```

### Detalles que hacen la diferencia

- **Carrera, no cola.** Preguntar de a uno y esperar 30 min no sirve para un hueco de
  mañana. Se avisa a varios a la vez y gana el primero — con `hold` atómico en base de
  datos para que no haya dos ganadores.
- **Aviso honesto a los perdedores.** Si no se hace, la gente odia el sistema.
- **Límite de frecuencia.** Nadie debe recibir cinco ofertas de rescate por semana.
- **Anticipación mínima configurable.** No ofrecer un hueco que empieza en 40 minutos.
- **Métrica visible:** "Este mes rescataste 14 cupos = $490".

CoverManager hace algo parecido en restaurantes de gama alta (ofrece horarios alternativos
o locales del grupo cuando se llena). En el segmento SMB de clínicas y servicios, **está
vacío**.

---

## 4. Reagendamiento masivo en un clic

Un dolor enorme, real, y que **nadie automatiza**:

> La Dra. Pérez se enferma el martes. Tiene 18 citas. Alguien tiene que llamar a 18
> personas, una por una, durante dos horas.

```
Panel → seleccionar profesional → "Bloquear martes 15"
      → el sistema pregunta: ¿qué hago con las 18 citas?

      [ Ofrecer reprogramación automática ]

      → cada paciente recibe por WhatsApp:
        "Hola María, tuvimos un imprevisto con la Dra. Pérez el martes 15.
         Te ofrecemos estas opciones:
         [ Mié 16, 10:00 ]  [ Jue 17, 09:30 ]  [ Ver más horarios ]
         Si prefieres, cancelamos sin costo."

      → el que elige, queda reagendado solo
      → el panel muestra: 14 reagendados · 2 cancelados · 2 sin responder → llamar
```

Convierte dos horas de teléfono en un clic. Es de las cosas que hacen que una
recepcionista defienda el software cuando el dueño quiera cambiarlo.

---

## 5. Escalera de confirmación + A/B testing de mensajes

Los competidores mandan **un** recordatorio. SuperConfirma ejecuta una secuencia adaptativa
que se detiene apenas el cliente confirma, con reglas por vertical y por riesgo:

```
Score alto (cliente confiable)  → 1 solo recordatorio 24 h antes
Score medio                     → 24 h + 3 h + SMS de respaldo
Score bajo                      → 48 h + 24 h + 3 h + SMS + llamada IA + alerta a recepción
```

Y encima: **A/B testing automático del copy**. El sistema prueba dos redacciones y se queda
con la que más confirma. La evidencia dice que esto vale entre 5 y 7 puntos porcentuales de
no-show, gratis. Ningún competidor del segmento lo ofrece.

Con el tiempo se acumula una **biblioteca de plantillas ganadoras por vertical** — otro
activo que no se copia leyendo la landing.

---

## 6. Overbooking calibrado

Prestado de las aerolíneas, y perfectamente aplicable a clínicas de alto volumen:

```
Martes 08:00, Dr. Ramírez, control de rutina
  Histórico: 22 % de no-show en esa combinación (n = 180 citas)
  Sugerencia: aceptar 11 citas para 9 espacios
  Riesgo de sobrecupo real: 6 %
  Tope configurado por el negocio: máx. 1 sobrecupo, máx. 10 % de riesgo
```

Se ofrece como **sugerencia con explicación**, nunca como automatismo oculto: el negocio
aprueba la política. El "plan de contingencia" (si llegan todos) también se configura.

Requiere volumen de datos → es una función de fase 3, y es un argumento fuertísimo para el
plan caro.

---

## 7. Modo Agencia / white-label real

**Tu caso de uso, y tu canal de distribución.**

Casi todas las plataformas de agendamiento tratan a la agencia como un cliente más. Lo que
falta:

- Un panel para administrar **N negocios** con cambio rápido entre ellos.
- **Marca propia**: logo, colores, dominio (`agenda.tuagencia.com`), remitente de correos.
- **Precio propio**: tú pagas $X por negocio y le cobras $Y a tu cliente.
- Facturación consolidada y métricas agregadas de toda la cartera.
- Plantillas replicables: configuras una clínica bien y la clonas para la siguiente.

Esto convierte a cada agencia y cada freelance de landing pages en un vendedor tuyo.
Es más barato que cualquier campaña de publicidad y es el camino natural para llegar a los
primeros 100 negocios (que es lo que el Confirm Score necesita).

---

## 8. Panel "Dinero Recuperado"

La primera pantalla al entrar no es un calendario: es el marcador.

```
┌────────────────────────────────────────────────┐
│  Septiembre 2026                               │
│                                                │
│     $1.430  recuperados este mes               │
│                                                │
│  ✅ 41 no-shows evitados        $1.435         │
│  🔄 14 cupos rescatados           $490         │
│  💰 6 anticipos retenidos         $120         │
│  ─────────────────────────────────────         │
│  Costo de SuperConfirma:          $59          │
│  Retorno:                          24×         │
└────────────────────────────────────────────────┘
```

Copiable en dos semanas por cualquiera, sí. Pero mientras nadie lo haga, es lo que hace
que el cliente **no dude en renovar** y lo cuente a otros. El churn se combate mostrando
valor, no con contratos.

---

## 9. Agendar dentro de WhatsApp (Flows)

El cliente escribe al WhatsApp del negocio y agenda **sin salir del chat**: servicio →
profesional → día → hora → listo. Sin navegador, sin formulario, sin link.

Es la conversión más alta posible en LatAm, donde WhatsApp es el canal por defecto.
Técnicamente exigente (endpoint de datos cifrado propio de Meta), lo que también es una
barrera de entrada. **Fase 3.**

---

## 10. Portabilidad radical

No es tecnología, es postura — y ataca de frente la queja principal del mercado:

> *"Exportación completa, webhooks y API abierta desde el plan más barato.
> Sin permanencia, sin costo de salida."*

Cuesta poco y desarma el principal miedo al cambiar de proveedor. Además hace que la
migración *hacia* ti sea creíble.

---

## Ideas descartadas (y por qué)

| Idea | Por qué no |
|---|---|
| Marketplace de clientes (tipo OpenTable) | Requiere demanda propia, es otro negocio entero, y pone tu marca por encima de la del cliente |
| Ficha clínica completa | Riesgo legal alto, competidores con 5 años de ventaja, valor bajo en fase 1 |
| Videollamada integrada | Google Meet/Zoom ya lo resuelven; basta con adjuntar el enlace |
| Chatbot de IA general | Todos lo prometen, casi ninguno lo usa. Mejor una IA acotada a agendar/reprogramar |
| App móvil nativa | Web responsive alcanza; una PWA más adelante si hace falta |
| Programa de fidelidad / puntos | Distrae del problema central |

---

## La frase que resume el producto

> **Otras plataformas te dejan agendar. SuperConfirma se asegura de que la gente llegue —
> y cuando alguien falla, vende el cupo otra vez antes de que te enteres.**

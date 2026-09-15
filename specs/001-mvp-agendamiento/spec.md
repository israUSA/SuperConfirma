# Spec 001 · MVP de agendamiento y confirmación

_Estado: **borrador para revisión** · 14 de septiembre de 2026_

Esta spec describe **qué** debe hacer el sistema y **por qué**. No define tecnología: eso va
en `plan.md`. Se rige por [`../constitution.md`](../constitution.md).

---

## 1. Problema

Un negocio que atiende con cita pierde entre el 15 % y el 25 % de su agenda por gente que no
llega. Hoy lo combate a mano: alguien escribe por WhatsApp uno por uno, o directamente no lo
hace. Cuando alguien cancela, el hueco se pierde porque nadie tiene tiempo de llamar a doce
personas.

Al mismo tiempo, el negocio quiere que sus clientes puedan reservar **desde su propia página
web**, sin mandarlos a una plataforma de terceros con otra marca.

## 2. Objetivo del MVP

> Que un negocio real en Ecuador pueda, en un solo día de configuración asistida, recibir
> reservas desde su web y confirmarlas automáticamente por WhatsApp, y que al final del mes
> pueda ver cuánto dinero le ahorró el sistema.

**Se considera exitoso si**, tras 60 días con 3 negocios piloto:

| Métrica | Meta |
|---|---|
| Inasistencia frente a su línea base | **−30 % o más** |
| Reservas completadas desde el widget / reservas iniciadas | **≥ 60 %** |
| Mensajes entregados / mensajes enviados | **≥ 95 %** |
| Reservas duplicadas o solapadas | **0** |
| Mensajes duplicados a un mismo cliente | **0** |

## 3. Actores

| Actor | Quién es | Dónde actúa |
|---|---|---|
| **Cliente final** | Paciente o comensal. No tiene cuenta y no la tendrá. | Página pública, widget, WhatsApp |
| **Recepción** | Quien opera la agenda día a día. Usuario menos técnico del sistema. | Panel |
| **Dueño** | Ve resultados, paga. Entra poco. | Panel |
| **Operador** (tú) | Configura negocios, soporta, ve costos. | Panel interno |

## 4. Alcance

### Dentro del MVP

- Alta y configuración de negocio, local, recursos, servicios y horarios
- Conexión del número de WhatsApp propio de cada negocio
- Página pública de reserva por local
- Widget embebible en cualquier web
- Flujo de reserva sin cuenta, con retención temporal del horario
- Confirmación inmediata y recordatorio por WhatsApp con botones
- Cancelación y reprogramación por el cliente, sin cuenta
- Agenda del día en el panel, con marcado de llegada y de inasistencia
- Panel de resultados ("dinero recuperado")
- Webhooks salientes firmados y exportación CSV
- Medición de mensajes y costos por negocio
- **Rubro v1: citas con profesional** (clínicas, estética, barbería, veterinaria, talleres).
  El núcleo ya soporta reservas de mesa (P13); se activa en v2 sin tocar el modelo

### Fuera del MVP (y por qué)

| Excluido | Motivo | Cuándo |
|---|---|---|
| Rescate automático de cupo | Es la joya, pero necesita la lista de espera y el motor de carrera bien hechos | Spec 002 |
| Confirm Score | Requiere 50-100 negocios con historial y revisión legal | Spec 004 |
| Depósitos y anticipos | Depende del score para tener sentido; agrega pasarela y reembolsos | Spec 004 |
| Plano visual de salón | Un producto en sí mismo | Spec 005 |
| Unión automática de mesas | Problema de optimización; en v1 se asigna la mesa más chica que quepa | Spec 005 |
| Walk-ins con cola física | Flujo presencial distinto | Spec 005 |
| Sincronización con Google Calendar | Épica completa (OAuth, tokens, conflictos). En MVP solo `.ics` | Spec 003 |
| **Reservas de mesa (restaurantes)** | Recortado para llegar antes al MVP funcional de un solo rubro (D-01 revisado 15-sep). El esquema y el core ya lo soportan | Spec 001-b |
| Ficha clínica | Riesgo legal alto, valor bajo en fase 1 | No planeado |
| Autoservicio de alta y cobro | Se opera como servicio gestionado en el año 1 (D-04) | Spec 006 |
| App móvil | La web responsive alcanza | No planeado |

## 5. Un solo modelo, dos rubros

El núcleo no sabe qué es una clínica ni qué es un restaurante. Sabe de **recursos con
capacidad** que se ocupan durante una **ventana de tiempo** (P13).

> **v1 construye solo la columna "Clínica / servicios".** La tabla queda completa porque es
> el contrato del modelo — cuando se active el rubro restaurante en v2, no debería requerir
> ni una migración ni un cambio en `packages/core`, solo UI y textos nuevos.

| | Clínica / servicios | Restaurante |
|---|---|---|
| Recurso | Dra. Pérez — capacidad 1 | Mesa 7 — capacidad 4 |
| Servicio | Limpieza dental — 30 min + 10 de buffer | Cena — 90 min estimados |
| Qué elige el cliente | Servicio, profesional, hora | Turno, cantidad de personas, hora |
| Unidades que ocupa | 1 | 1 por comensal |
| Modo de disponibilidad | Grilla de slots cada 15/20/30 min | Turno con capacidad total y rotación |
| Asignación | El cliente elige el recurso, o se asigna cualquiera libre | El sistema asigna la mesa más chica donde quepa el grupo |
| Si no hay lugar | Se ofrecen horarios cercanos | Se ofrecen horarios cercanos del mismo turno |

**Diferencias de rubro permitidas:** textos, campos del formulario, modo de disponibilidad
(`slot` o `turno`), y regla de asignación. Nada más.

---

## 6. Historias de usuario

### HU-01 · Dar de alta un negocio

**Como** operador, **quiero** configurar un negocio completo en una sesión **para que**
pueda recibir reservas el mismo día.

- [ ] Puedo crear cuenta → negocio → local, con zona horaria (`America/Guayaquil` o
      `America/Galapagos`) y moneda USD
- [ ] Puedo crear recursos con nombre, capacidad y horario semanal
- [ ] Puedo crear servicios con duración, buffers, precio de referencia y qué recursos los prestan
- [ ] Puedo cargar excepciones: feriados, vacaciones, bloqueos puntuales
- [ ] Puedo definir la ventana de reserva: anticipación mínima y máxima
- [ ] Al terminar, el local tiene una URL pública funcionando
- [ ] Configurar un negocio completo toma **menos de 30 minutos**

### HU-02 · Conectar el WhatsApp del negocio

**Como** operador, **quiero** conectar el número propio del negocio **para que** los
mensajes salgan con su identidad.

- [ ] Existe un flujo guiado de conexión del número del negocio
- [ ] El estado de la conexión es visible: `sin conectar` · `en verificación` ·
      `plantillas pendientes` · `activo` · `degradado`
- [ ] Las plantillas maestras se envían a aprobación automáticamente al conectar el número,
      y su estado individual es visible
- [ ] Si la calidad del número cae a nivel crítico, el envío se detiene solo y se avisa

> ⚠️ Las plantillas se aprueban por cada cuenta de WhatsApp, no se comparten entre negocios.
> El sistema mantiene una plantilla maestra versionada y la replica en cada alta.

### HU-03 · Reservar desde la página pública

**Como** cliente final, **quiero** reservar en pocos pasos y sin crear cuenta.

- [ ] Elijo servicio (o cantidad de personas y turno), luego día y hora
- [ ] Solo veo horarios realmente disponibles, en la zona horaria del local
- [ ] Al elegir un horario, queda **retenido a mi nombre durante 10 minutos**
- [ ] Ingreso nombre, teléfono y, opcional, correo — nada más
- [ ] Acepto de forma explícita recibir confirmaciones por WhatsApp, y ese consentimiento
      queda registrado con el texto exacto mostrado
- [ ] Recibo la confirmación en pantalla y por WhatsApp
- [ ] Si la retención expira antes de terminar, se me avisa con claridad y puedo elegir otro horario
- [ ] Todo el flujo funciona en un teléfono de gama baja con conexión lenta

### HU-04 · Reservar desde el widget en la web del negocio

**Como** dueño, **quiero** poner la agenda dentro de mi propia página.

- [ ] Se instala con **una línea** de código
- [ ] Funciona incrustado en la página, como ventana modal, y como botón flotante
- [ ] El estilo del sitio anfitrión no rompe el widget, ni el widget rompe el sitio
- [ ] La altura se ajusta sola según el paso del formulario
- [ ] Emite un evento de conversión al completarse, para que el dueño dispare su píxel de publicidad
- [ ] Solo carga desde los dominios autorizados para ese negocio
- [ ] Puedo preseleccionar servicio o profesional desde el código de instalación

### HU-05 · Confirmar por WhatsApp

**Como** cliente final, **quiero** confirmar con un toque.

- [ ] Al reservar recibo confirmación inmediata con fecha, hora, lugar y con quién
- [ ] Recibo un recordatorio 24 h antes con botones: confirmar, reprogramar, cancelar
- [ ] Si no respondo, recibo un segundo recordatorio unas horas antes — y **solo si no confirmé**
- [ ] Apenas confirmo, la secuencia se detiene por completo
- [ ] Si escribo "sí", "confirmo", "ok" o similar en vez de tocar el botón, se entiende igual
- [ ] Si escribo algo que el sistema no entiende, la conversación aparece en el panel del
      negocio en lugar de recibir una respuesta equivocada
- [ ] El mensaje **no menciona el nombre del servicio** salvo que el negocio lo habilite
- [ ] Puedo darme de baja respondiendo, y esa baja se respeta en toda la red

### HU-06 · Cancelar o reprogramar sin cuenta

**Como** cliente final, **quiero** cambiar mi reserva sin llamar ni registrarme.

- [ ] Desde el botón de WhatsApp o desde un enlace, accedo a mi reserva sin contraseña
- [ ] Puedo cancelar, y el horario queda libre de inmediato
- [ ] Puedo elegir otro horario disponible; la reserva anterior queda enlazada a la nueva
- [ ] El enlace es de un solo uso y expira; no permite ver reservas de otras personas
- [ ] El negocio recibe aviso en el panel

### HU-07 · Operar la agenda del día

**Como** recepción, **quiero** ver y gestionar el día de hoy.

- [ ] Veo la agenda del día por recurso, con el estado de confirmación de cada reserva
- [ ] Distingo de un vistazo quién confirmó, quién no respondió y quién canceló
- [ ] Puedo crear una reserva manual (llamada telefónica o mostrador)
- [ ] Puedo marcar llegada, atención completada o inasistencia
- [ ] Puedo bloquear un horario o un día completo de un recurso
- [ ] Puedo reenviar el recordatorio a una persona puntual
- [ ] Si el sistema no pudo entregar un mensaje, lo veo y sé a quién llamar

### HU-08 · Ver el resultado

**Como** dueño, **quiero** saber si esto me sirve.

- [ ] Al entrar, lo primero que veo es cuánto dinero salvó el sistema este mes
- [ ] Veo inasistencia actual comparada con la línea base del negocio
- [ ] Veo cuántas reservas llegaron por cada canal (web, widget, manual)
- [ ] Veo el cálculo desglosado, no solo el total: quiero entender de dónde sale el número
- [ ] Puedo cambiar el ticket promedio que se usa para estimar

### HU-09 · Llevar las reservas a otra plataforma

**Como** dueño o su desarrollador, **quiero** que las reservas lleguen a mi otro sistema.

- [ ] Configuro una o más direcciones de destino y elijo qué eventos recibir
- [ ] Los eventos cubren el ciclo completo: creada, confirmada, reprogramada, cancelada,
      no asistió, completada
- [ ] Cada envío va firmado, para que el receptor verifique que viene de SuperConfirma
- [ ] Si mi sistema está caído, se reintenta con espera creciente y no se pierde nada
- [ ] Veo cada intento con su respuesta, y puedo reenviar a mano
- [ ] Puedo disparar un evento de prueba desde el panel
- [ ] Puedo exportar todas las reservas a CSV cuando quiera

### HU-10 · Operar cuando WhatsApp todavía no está listo

**Como** operador, **quiero** que el negocio funcione mientras Meta aprueba su número.

- [ ] El negocio puede recibir reservas apenas se configura, sin esperar a WhatsApp
- [ ] Mientras tanto, las confirmaciones salen por correo y la recepción ve un aviso de qué
      reservas necesitan confirmación manual
- [ ] Al activarse WhatsApp, el flujo automático empieza sin reconfigurar nada

### HU-11 · Controlar el costo

**Como** operador, **quiero** saber qué me cuesta cada negocio.

- [ ] Veo mensajes enviados por negocio, por tipo y por mes, con costo estimado
- [ ] Veo cuánto le queda a cada negocio de su bolsón incluido
- [ ] Puedo poner un tope de envíos por negocio y por cliente

---

## 7. Reglas de negocio invariantes

| # | Regla |
|---|---|
| R-01 | Dos reservas nunca ocupan el mismo recurso en horarios que se solapen |
| R-02 | La suma de unidades reservadas nunca supera la capacidad del recurso ni la del turno |
| R-03 | Una reserva cancelada libera el horario de inmediato |
| R-04 | Una retención sin completar expira a los 10 minutos y libera el horario |
| R-05 | Nunca se envía el mismo mensaje dos veces para la misma reserva, tipo y ventana |
| R-06 | No se envía ningún mensaje sin consentimiento registrado |
| R-07 | Una baja se respeta en todos los negocios de la red, para siempre |
| R-08 | Los buffers de un servicio ocupan tiempo real del recurso, aunque el cliente no los vea |
| R-09 | No se ofrece un horario que incumpla la anticipación mínima configurada |
| R-10 | Confirmar detiene toda la secuencia pendiente de esa reserva |
| R-11 | Ningún dato de un negocio es accesible desde otro negocio, por ninguna vía |

## 8. Requisitos no funcionales

| Área | Requisito |
|---|---|
| Velocidad | La página de reserva muestra horarios en **< 1,5 s** en 4G |
| Peso | El widget agrega **< 40 KB** a la página que lo hospeda |
| Disponibilidad | La reserva pública funciona aunque el panel esté caído |
| Accesibilidad | El flujo de reserva es operable solo con teclado y con lector de pantalla |
| Idioma | Español; todos los textos externalizados desde el inicio |
| Privacidad | Teléfonos, nombres y motivos enmascarados en logs y errores |
| Retención | Las reservas se anonimizan a los 24 meses |
| Auditoría | Toda acción del panel que modifique una reserva queda registrada con autor y fecha |

## 9. Preguntas abiertas

| # | Pregunta | Bloquea |
|---|---|---|
| Q-01 | ¿Cuánto tiempo semanal hay disponible para desarrollo? Define si el MVP son 6 o 14 semanas | El plan, no la spec |
| Q-02 | ¿Existe ya cuenta de Meta Business verificada? Si no, hay que iniciarla ya: tarda días | HU-02 |
| Q-03 | ¿Qué negocios concretos son los 3 pilotos? Su rubro define qué se prueba primero | La secuencia de tareas |
| Q-04 | ¿Se cobra a los pilotos o son gratuitos a cambio de datos y testimonio? | Nada técnico |
| Q-05 | ¿El dominio `superconfirma` está disponible y libre de conflicto de marca en Ecuador? | La marca, no el código |
| Q-06 | ~~Para restaurantes: ¿el piloto acepta asignación automática de mesa...~~ — diferida a Spec 001-b, no bloquea v1 | — |

## 10. Definición de terminado

El MVP está terminado cuando:

1. Al menos un negocio piloto de citas con profesional está configurado y recibiendo
   reservas reales de clientes reales.
2. Todas las historias tienen sus criterios marcados.
3. Las once reglas invariantes tienen tests automáticos, incluidos los que intentan violarlas
   saltándose la aplicación.
4. La suite de aislamiento entre negocios pasa en CI.
5. Un negocio puede exportar todos sus datos y recibir sus eventos por webhook.
6. Existe un procedimiento escrito de alta de negocio que un tercero pueda ejecutar.

---

## Siguiente paso

Revisar esta spec → ajustar → escribir `plan.md` (arquitectura, esquema de datos,
decisiones técnicas) → `tasks.md` (pasos ejecutables).

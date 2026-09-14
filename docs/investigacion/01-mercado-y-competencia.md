# 01 · Mercado y competencia

## 1. Los cuatro bloques de competidores

No compites contra "todos". Son cuatro mercados distintos con dinámicas distintas:

### A. Agendas horizontales (el rival directo en LatAm)

| Producto | Alcance | Precio | Fuerte en | Débil en |
|---|---|---|---|---|
| **AgendaPro** | 20.000+ negocios LatAm | desde ~$19/usuario/mes | Horizontal (clínicas, spas, gyms, estética), app móvil, referente regional | Precio por usuario escala feo; confirmación básica; sin capa de agencia |
| **Reservo** (CL) | 500+ clínicas | desde ~$30/mes (1 profesional), ~$50 hasta 3 | Ficha clínica madura, odontograma, DTE chileno | Muy Chile-céntrico, no publica precios, producto pesado |
| **Clinera** | LatAm | hasta $479/mes | "Empleados digitales" IA | Caro, nicho alto |
| **Calendly / Cal.com** | Global | $0-16/usuario/mes | Simplicidad brutal, integraciones | Pensado para 1:1 remoto, no para negocio local con recepción |

👉 **Aprendizaje:** el rango real de precio en LatAm es **$19–$79/mes** para un negocio
pequeño. Arriba de $100/mes necesitas justificar con algo más que agenda.

### B. Verticales de restaurante

| Producto | Notas |
|---|---|
| **CoverManager** | 36.000+ locales. Reservas sin comisión, depósitos, pagos, datos de comensal, upselling, gestión de turnos y plano de salón. Reasignación automática a otros horarios o locales del grupo cuando se llena. **No publica precios** (venta por cotización). |
| **OpenTable / TheFork** | Modelo marketplace + comisión por cubierto. Traen demanda, pero se quedan con el cliente. |
| **Meitre** | Fuerte en Argentina/Chile/México, gama alta. |

👉 **Aprendizaje:** el restaurante de gama media/baja en LatAm **sigue usando WhatsApp y
cuaderno**. Ahí está el hueco, pero es un mercado de bajo ticket y alta rotación.
El de gama alta ya está tomado por CoverManager/Meitre.

### C. Herramientas de recordatorio puro

Apps que solo mandan recordatorios SMS/WhatsApp encima de una agenda existente. Bajo
ticket, cero defensa. **Este es el error que hay que evitar**: si SuperConfirma es solo
"recordatorios", es una commodity que cualquiera clona en un fin de semana.

### D. Open source / self-hosted

**Cal.com** cambió de modelo: el producto principal pasó a closed-source y la edición
comunitaria se separó como **Cal.diy con licencia MIT** (abril 2026), pero está
explícitamente recomendada "para uso personal, no productivo" y el uso comercial te manda
a la licencia comercial. Antes era AGPLv3 + Enterprise Edition.

> ⚠️ **Implicación:** partir de un fork de Cal.com/Cal.diy para un SaaS comercial es
> jurídicamente resbaladizo y además te ata a un modelo de datos pensado para reuniones 1:1,
> no para "recurso con capacidad". **Recomendación: construir propio.** El núcleo de
> disponibilidad no es tan grande, y el valor está en la capa de confirmación, no en el
> calendario.

## 2. Los huecos reales del mercado (lo que la gente odia)

Extraído de reseñas y comparativas de software de agendamiento:

| Queja recurrente | Oportunidad para SuperConfirma |
|---|---|
| "Automatiza la reserva pero la sala de espera / los walk-ins se siguen manejando a mano" | Cerrar el ciclo completo: reserva → confirmación → llegada → no-show → rescate |
| "Precio por profesional que escala más rápido de lo esperado" | Precio por **local**, no por usuario. Argumento de venta directo. |
| "Contratos largos con poca flexibilidad" | Mes a mes, sin permanencia, exportación total de datos |
| "La integración con el otro sistema no funciona como prometieron" | **Webhooks + API pública de primera clase**, no un "conector" cerrado |
| "Las listas de espera no aplican a X caso" | Lista de espera como motor central, no como feature secundaria |

## 3. Posicionamiento recomendado

> **SuperConfirma no es una agenda. Es el sistema que hace que la gente llegue.**

Tres frases para la landing:

1. *"Tus clientes agendan solos desde tu página. WhatsApp los confirma. Si alguien cancela,
   el cupo se revende automáticamente."*
2. *"Este mes recuperaste $1.430 que se te iban a perder."*
3. *"Se instala en tu web con una línea de código. Tus datos salen por API cuando quieras."*

### Contra quién posicionarse en cada venta

| Si el cliente usa… | El ángulo |
|---|---|
| Cuaderno / WhatsApp manual | "Dejas de contestar 40 mensajes al día" (ahorro de tiempo) |
| AgendaPro / Reservo | "No te pedimos cambiar de sistema: nos conectamos y te bajamos el no-show" → **estrategia de integración, no de reemplazo** |
| Calendly | "Calendly no le escribe a tu cliente por WhatsApp ni rescata el cupo" |
| Nada (negocio nuevo con landing) | Venta empaquetada: landing + agenda + confirmación |

## 4. El canal de distribución que ya tienes

Vendes landing pages. Eso es una ventaja injusta frente a un SaaS puro:

- Cada landing que vendes puede salir **con SuperConfirma incluido** (bundle).
- El cliente no "compra software", compra "mi página con agenda que funciona".
- Te da los primeros 10-20 tenants reales sin gastar en marketing, que es lo que
  necesitas para que el **Confirm Score** tenga datos.
- Justifica la capa de **Modo Agencia** desde el diseño, no como parche.

## 5. Tamaño y orden de ataque de verticales

| Vertical | Volumen de citas | Dolor de no-show | Complejidad técnica | Prioridad |
|---|---|---|---|---|
| Consultorios / odontología / fisio | Alto | 🔴 Muy alto | Baja | **1** |
| Estética / barbería / spa / uñas | Muy alto | 🔴 Muy alto | Baja | **1** |
| Veterinaria | Medio | 🟠 Alto | Baja | 2 |
| Talleres / servicios a domicilio | Medio | 🟠 Alto | Media (rutas) | 3 |
| Canchas deportivas / salones | Medio | 🟡 Medio | Baja (capacidad N) | 2 |
| Restaurantes | Muy alto | 🔴 Muy alto | 🔴 Alta (mesas) | 4 |
| Tours / experiencias | Bajo | 🟡 Medio | Media (cupos grupales) | 4 |

Las de prioridad 1 comparten **exactamente el mismo modelo de datos**. Eso permite un MVP
que sirve a cuatro verticales sin trabajo extra.

---

## Fuentes

- [AgendaPro — apps para agendar citas 2026](https://agendapro.com/blog/apps-para-agendar-citas/)
- [Medesk — Reseña de AgendaPro 2026](https://www.medesk.net/es/blog/agenda-pro-review/)
- [Clinera — Mejor software para clínicas LATAM 2026](https://www.clinera.io/mejor-software-clinicas)
- [Turnito — Software de reservas para clínicas en Chile 2026](https://turnito.app/blog/los-mejores-software-de-reservas-para-clinicas-en-chile-2026/)
- [CoverManager — Reservation software](https://www.covermanager.com/en/solutions/reservation-software/)
- [Capterra — CoverManager pricing & alternatives 2026](https://www.capterra.com/p/229015/CoverManager/)
- [Cal.com — Going closed-source: técnica detrás de Cal.diy](https://cal.com/blog/cal-diy-open-source-to-closed-source)
- [Cal.com — Changing to AGPLv3 and Enterprise Edition](https://cal.com/blog/changing-to-agplv3-and-introducing-enterprise-edition)
- [Cal.com — Self-hosted commercial license](https://i.cal.com/sales/commercial-license)
- [WaitWell — Best patient scheduling software 2026](https://waitwellsoftware.com/resources/articles/best-patient-scheduling-software/)
- [Morelune — Patient scheduling software to reduce no-shows](https://morelune.com/blog/patient-scheduling-software-reduce-no-shows)

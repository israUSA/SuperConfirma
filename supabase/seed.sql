-- Semilla de desarrollo: una clínica de estética en Quito (rubro v1).
-- IDs fijos para que los tests y el panel local puedan referenciarlos.

insert into public.account (id, name) values
  ('00000000-0000-4000-a000-000000000001', 'Aura Estética S.A.S.');

insert into public.business (id, account_id, slug, name, vertical) values
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001',
   'aura-estetica', 'Aura Estética Avanzada', 'appointments');

insert into public.location (id, business_id, name, timezone, address, min_advance_min, max_advance_days) values
  ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-b000-000000000001',
   'Sucursal González Suárez', 'America/Guayaquil', 'Av. González Suárez N31-102, Quito', 120, 30);

insert into public.resource (id, business_id, location_id, name, sort_order) values
  ('00000000-0000-4000-d000-000000000001', '00000000-0000-4000-b000-000000000001',
   '00000000-0000-4000-c000-000000000001', 'Dra. Valeria Paredes', 1),
  ('00000000-0000-4000-d000-000000000002', '00000000-0000-4000-b000-000000000001',
   '00000000-0000-4000-c000-000000000001', 'Lic. Mateo Andrade', 2);

insert into public.service (id, business_id, location_id, name, duration_min, buffer_after_min, price_cents, sensitive) values
  ('00000000-0000-4000-e000-000000000001', '00000000-0000-4000-b000-000000000001',
   '00000000-0000-4000-c000-000000000001', 'Limpieza Facial Profunda', 45, 15, 3500, false),
  ('00000000-0000-4000-e000-000000000002', '00000000-0000-4000-b000-000000000001',
   '00000000-0000-4000-c000-000000000001', 'Botox Facial (3 zonas)', 45, 15, 18000, true),
  ('00000000-0000-4000-e000-000000000003', '00000000-0000-4000-b000-000000000001',
   '00000000-0000-4000-c000-000000000001', 'Valoración inicial', 30, 0, 0, false);

insert into public.service_resource (business_id, service_id, resource_id) values
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-e000-000000000001', '00000000-0000-4000-d000-000000000001'),
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-e000-000000000001', '00000000-0000-4000-d000-000000000002'),
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-e000-000000000002', '00000000-0000-4000-d000-000000000001'),
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-e000-000000000003', '00000000-0000-4000-d000-000000000001'),
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-e000-000000000003', '00000000-0000-4000-d000-000000000002');

-- Horario del local: lunes a viernes 09:00–13:00 y 14:00–18:00, grilla de 30 min.
insert into public.availability_rule (business_id, location_id, weekday, starts_local, ends_local, slot_minutes)
select '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-c000-000000000001', d, s, e, 30
from generate_series(1, 5) d,
     (values ('09:00'::time, '13:00'::time), ('14:00'::time, '18:00'::time)) h(s, e);

-- Lic. Andrade tiene horario propio: martes y jueves por la tarde, y sábado por la mañana.
insert into public.availability_rule (business_id, location_id, resource_id, weekday, starts_local, ends_local, slot_minutes) values
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-c000-000000000001', '00000000-0000-4000-d000-000000000002', 2, '14:00', '19:00', 30),
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-c000-000000000001', '00000000-0000-4000-d000-000000000002', 4, '14:00', '19:00', 30),
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-c000-000000000001', '00000000-0000-4000-d000-000000000002', 6, '09:00', '12:00', 30);

insert into public.message_template (key, version, category, body, buttons) values
  ('booking_confirmation', 1, 'UTILITY',
   '¡Hola {{1}}! Tu cita en {{2}} quedó confirmada. Fecha: {{3}}. Con: {{4}}. Lugar: {{5}}.',
   '[{"type":"QUICK_REPLY","text":"Cambiar horario"},{"type":"QUICK_REPLY","text":"Cancelar cita"}]'),
  ('reminder_24h', 1, 'UTILITY',
   'Hola {{1}}, te recordamos tu cita en {{2}} mañana {{3}}. ¿Nos confirmas tu asistencia?',
   '[{"type":"QUICK_REPLY","text":"Confirmo"},{"type":"QUICK_REPLY","text":"Cambiar horario"},{"type":"QUICK_REPLY","text":"Cancelar cita"}]');

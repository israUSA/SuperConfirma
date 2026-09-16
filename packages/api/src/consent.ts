/**
 * P6: the page shows this text as served by the API, and the API stores this same text.
 * Changing the wording means a new version, never an edit of an existing one.
 */
export const CONSENT = {
  version: '2026-09-v1',
  channel: 'whatsapp',
  text: 'Acepto recibir confirmaciones y recordatorios de esta cita por WhatsApp',
} as const;

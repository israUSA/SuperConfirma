import { describe, expect, it } from 'vitest';
import { buildIcs } from '../src/email/ics.ts';

describe('buildIcs', () => {
  const ics = buildIcs({
    uid: 'abc',
    start: new Date('2026-10-19T14:00:00Z'),
    end: new Date('2026-10-19T14:45:00Z'),
    stamp: new Date('2026-10-18T20:00:00Z'),
    summary: 'Cita en Aura, Estética; Avanzada',
    location: 'Av. González Suárez N31-102, Quito',
    description: `Cambiar o cancelar: https://reservas.test/gestionar/${'x'.repeat(43)}`,
  });

  it('usa CRLF y fechas en UTC', () => {
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.split('\r\n')).toContain('DTSTART:20261019T140000Z');
    expect(ics.split('\r\n')).toContain('DTEND:20261019T144500Z');
  });

  it('escapa comas y punto y coma', () => {
    expect(ics).toContain('SUMMARY:Cita en Aura\\, Estética\\; Avanzada');
  });

  it('pliega líneas largas a 75 octetos sin partir caracteres', () => {
    const lines = ics.split('\r\n');
    expect(lines.every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain(`gestionar/${'x'.repeat(43)}`);
    expect(unfolded).toContain('LOCATION:Av. González Suárez N31-102\\, Quito');
  });
});

import { describe, expect, it } from 'vitest';
import { maskPhone, normalizePhone } from '../src/index.ts';

describe('normalizePhone', () => {
  it.each([
    '0998765432',
    '099 876 5432',
    '099-876-5432',
    '998765432',
    '+593 99 876 5432',
    '+593998765432',
    '00593998765432',
    '593998765432',
    '(099) 876-5432',
  ])('%s → +593998765432', (raw) => {
    expect(normalizePhone(raw)).toEqual({ ok: true, e164: '+593998765432' });
  });

  it('rechaza teléfonos fijos de Ecuador: WhatsApp necesita un celular', () => {
    expect(normalizePhone('02 298 4500')).toEqual({ ok: false, reason: 'not_mobile' });
    expect(normalizePhone('+59322984500')).toEqual({ ok: false, reason: 'not_mobile' });
  });

  it.each(['', 'abc', '09987654', '09987654321', '+0123456789', '+5939987654321'])('rechaza %j', (raw) => {
    expect(normalizePhone(raw)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('acepta números extranjeros en formato internacional', () => {
    expect(normalizePhone('+57 300 123 4567')).toEqual({ ok: true, e164: '+573001234567' });
  });
});

describe('maskPhone', () => {
  it('deja visibles solo el prefijo y los últimos 4 dígitos', () => {
    expect(maskPhone('+593998765432')).toBe('+593•••••5432');
  });
});

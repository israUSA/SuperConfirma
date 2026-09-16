export type PhoneResult =
  | { ok: true; e164: string }
  | { ok: false; reason: 'invalid' | 'not_mobile' };

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Normalizes what a customer types into E.164. Ecuador is the default market (D-02):
 * "099 876 5432", "0998765432" and "998765432" all become +593998765432.
 * Only mobile numbers are accepted for Ecuador, because confirmations go by WhatsApp.
 */
export function normalizePhone(raw: string, defaultCountry: 'EC' = 'EC'): PhoneResult {
  let digits = raw.trim().replace(/[\s().-]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;

  if (digits.startsWith('+')) {
    if (!E164.test(digits)) return { ok: false, reason: 'invalid' };
    if (digits.startsWith('+593')) return ecuador(digits.slice(4));
    return { ok: true, e164: digits };
  }

  if (!/^\d+$/.test(digits)) return { ok: false, reason: 'invalid' };
  if (defaultCountry === 'EC') {
    if (digits.startsWith('593') && digits.length === 12) return ecuador(digits.slice(3));
    return ecuador(digits.startsWith('0') ? digits.slice(1) : digits);
  }
  return { ok: false, reason: 'invalid' };
}

function ecuador(national: string): PhoneResult {
  if (/^9\d{8}$/.test(national)) return { ok: true, e164: `+593${national}` };
  if (/^[2-7]\d{7}$/.test(national)) return { ok: false, reason: 'not_mobile' };
  return { ok: false, reason: 'invalid' };
}

/** For logs and error reports (P7): +593998765432 → +593•••••5432 */
export function maskPhone(e164: string): string {
  return e164.length <= 8 ? '•••' : `${e164.slice(0, 4)}${'•'.repeat(e164.length - 8)}${e164.slice(-4)}`;
}

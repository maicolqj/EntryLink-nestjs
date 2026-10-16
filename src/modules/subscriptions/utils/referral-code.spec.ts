import { generateReferralCode, normalizeReferralCode } from './referral-code';

describe('código de recomendación', () => {
  it('tiene 8 caracteres sin los que se confunden al dictarlo', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateReferralCode();
      expect(code).toMatch(/^[2-9A-HJKMNP-Z]{8}$/);
    }
  });

  it('acepta el código escrito en minúsculas, con espacios o guiones', () => {
    expect(normalizeReferralCode(' ab12-cd34 ')).toBe('AB12CD34');
  });

  it('vacío = sin recomendación', () => {
    expect(normalizeReferralCode('  ')).toBeNull();
    expect(normalizeReferralCode(undefined)).toBeNull();
  });
});

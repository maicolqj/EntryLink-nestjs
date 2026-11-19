import { GrowthIdentifierType as T } from './growth.enums';
import { normalizeIdentifier } from './identifier-normalizer';

describe('normalizeIdentifier', () => {
  it.each([
    [' Ventas@Empresa.CO ', 'ventas@empresa.co'],
    ['admin@ph.com.co', 'admin@ph.com.co'],
  ])('correo %p → %p', (raw, expected) => {
    expect(normalizeIdentifier(T.EMAIL, raw)).toBe(expected);
  });

  it.each(['sin-arroba', 'a@b', '', '   '])('correo inválido %p', (raw) => {
    expect(normalizeIdentifier(T.EMAIL, raw)).toBeNull();
  });

  it.each([
    ['300 123 4567', '+573001234567'],
    ['+57 300-123-4567', '+573001234567'],
    ['573001234567', '+573001234567'],
    ['(601) 234 5678', '+576012345678'],
    ['+1 415 555 0100', '+14155550100'],
  ])('teléfono %p → %p', (raw, expected) => {
    expect(normalizeIdentifier(T.PHONE, raw)).toBe(expected);
  });

  it.each(['12345', '2001234567', 'abc'])('teléfono inválido %p', (raw) => {
    expect(normalizeIdentifier(T.PHONE, raw)).toBeNull();
  });

  it('el NIT ignora puntos y dígito de verificación', () => {
    expect(normalizeIdentifier(T.NIT, '900.123.456-7')).toBe('900123456');
    expect(normalizeIdentifier(T.NIT, '900123456')).toBe('900123456');
    expect(normalizeIdentifier(T.NIT, '12-3')).toBeNull();
  });

  it('el dominio se reduce a su forma base', () => {
    expect(
      normalizeIdentifier(
        T.DOMAIN,
        'https://www.Administradora.com.co/contacto',
      ),
    ).toBe('administradora.com.co');
    expect(normalizeIdentifier(T.DOMAIN, 'no es dominio')).toBeNull();
  });
});

import {
  nitCheckDigit,
  normalizeBogotaAddress,
  normalizeOrganizationName,
  normalizePropertyName,
  normalizeRegistration,
  splitNit,
} from './prospect-normalizers';

describe('normalizadores de Prospect', () => {
  it.each([
    ['Administraciones Andes S.A.S.', 'administraciones andes'],
    ['ADMINISTRACIONES  ANDES SAS', 'administraciones andes'],
    ['Gestión Integral Ltda.', 'gestion integral'],
  ])('empresa %p → %p', (raw, expected) => {
    expect(normalizeOrganizationName(raw)).toBe(expected);
  });

  it.each([
    ['Conjunto Residencial Los Pinos P.H.', 'los pinos'],
    ['Edificio Torre Norte - Propiedad Horizontal', 'torre norte'],
    ['Agrupación de Vivienda El Bosque', 'el bosque'],
  ])('copropiedad %p → %p', (raw, expected) => {
    expect(normalizePropertyName(raw)).toBe(expected);
  });

  it.each([
    ['Cra. 15 # 93-47 Of 301', 'KR 15 93 47'],
    ['Carrera 15 No. 93 - 47', 'KR 15 93 47'],
    ['Calle 100 # 15-20 Torre 2 Apto 501', 'CL 100 15 20'],
    ['Av. Calle 26 # 69-76', 'AC 26 69 76'],
    ['Transversal 60 # 115-58', 'TV 60 115 58'],
    ['Diagonal 40A Bis # 7-10 Sur', 'DG 40A BIS 7 10 SUR'],
  ])('dirección %p → %p', (raw, expected) => {
    expect(normalizeBogotaAddress(raw)).toBe(expected);
  });

  it('dirección sin tipo de vía reconocible → null', () => {
    expect(normalizeBogotaAddress('Vereda El Salitre')).toBeNull();
  });

  it('NIT: separa el dígito y calcula el de la DIAN', () => {
    expect(splitNit('890.903.938-8')).toEqual({
      nit: '890903938',
      checkDigit: '8',
    });
    expect(splitNit('899999068')).toEqual({
      nit: '899999068',
      checkDigit: null,
    });
    expect(splitNit('12-3')).toBeNull();
    expect(nitCheckDigit('890903938')).toBe('8');
    expect(nitCheckDigit('899999068')).toBe('1');
  });

  it('matrícula inmobiliaria', () => {
    expect(normalizeRegistration('50c-123 4567')).toBe('50C1234567');
  });
});

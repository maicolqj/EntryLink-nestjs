import { PEM_FOOTER, PEM_HEADER, normalizePem } from './pem.utils';

/**
 * Los cuatro daños de aquí son reales, vistos al configurar Firebase en el panel
 * de despliegue. Todos producen el mismo error de OpenSSL
 * (`DECODER routines::unsupported`), así que sin estas pruebas la única forma de
 * distinguirlos es redesplegar y mirar si el API se cae.
 */
describe('normalizePem', () => {
  // Cuerpo de 128 caracteres: obliga a troquelar en más de una línea de 64.
  const BODY_LINES = ['A'.repeat(64), 'B'.repeat(64)];
  const SANE = `${PEM_HEADER}\n${BODY_LINES.join('\n')}\n${PEM_FOOTER}\n`;

  it('deja intacta una llave bien formada', () => {
    expect(normalizePem(SANE)).toBe(SANE);
  });

  it('añade el salto final cuando falta', () => {
    expect(normalizePem(SANE.trimEnd())).toBe(SANE);
  });

  it('quita las comillas que arrastra el JSON', () => {
    expect(normalizePem(`"${SANE.trimEnd()}"`)).toBe(SANE);
    expect(normalizePem(`'${SANE.trimEnd()}'`)).toBe(SANE);
  });

  it('convierte los \\n literales (el caso clásico de .env)', () => {
    const damaged = SANE.replace(/\n/g, '\\n');
    expect(normalizePem(damaged)).toBe(SANE);
  });

  it('repara el escapado doble sin dejar barras sueltas', () => {
    const damaged = SANE.replace(/\n/g, '\\\\n');
    const repaired = normalizePem(damaged);
    expect(repaired).toBe(SANE);
    expect(repaired).not.toContain('\\');
  });

  it('reconstruye el troquelado cuando el panel borró los saltos', () => {
    const damaged = `${PEM_HEADER}${BODY_LINES.join('')}${PEM_FOOTER}`;
    expect(normalizePem(damaged)).toBe(SANE);
  });

  it('respeta un cuerpo ya troquelado aunque no midan 64', () => {
    const short = `${PEM_HEADER}\nAAAA\nBBBB\n${PEM_FOOTER}\n`;
    expect(normalizePem(short)).toBe(short);
  });

  it('devuelve el texto tal cual si no hay PEM que reparar', () => {
    expect(normalizePem('no soy una llave')).toBe('no soy una llave\n');
  });
});

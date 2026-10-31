import { ConfigService } from '@nestjs/config';
import { GrowthHashService } from './growth-hash.service';
import { GrowthIdentifierType as T } from './growth.enums';

const KEY_1 = Buffer.alloc(32, 1).toString('base64');
const KEY_2 = Buffer.alloc(32, 2).toString('base64');

const service = (keys: string, active: number | string) =>
  new GrowthHashService({
    get: (k: string) =>
      k === 'GROWTH_SUPPRESSION_HMAC_KEYS' ? keys : String(active),
  } as unknown as ConfigService);

describe('GrowthHashService', () => {
  it('es determinista y nunca devuelve el dato en claro', () => {
    const s = service(`1:${KEY_1}`, 1);
    const a = s.hashActive(T.EMAIL, 'Ventas@Empresa.co');
    const b = s.hashActive(T.EMAIL, ' ventas@empresa.co ');
    expect(a).toEqual(b);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).not.toContain('ventas');
    expect(a.keyVersion).toBe(1);
  });

  it('el tipo forma parte del hash: un NIT y un teléfono iguales no colisionan', () => {
    const s = service(`1:${KEY_1}`, 1);
    expect(s.hashActive(T.NIT, '3001234567').hash).not.toBe(
      s.hashActive(T.PHONE, '3001234567').hash,
    );
  });

  describe('rotación sin los datos originales', () => {
    it('escribe con la versión activa y consulta con todas', () => {
      const before = service(`1:${KEY_1}`, 1);
      const after = service(`1:${KEY_1},2:${KEY_2}`, 2);

      const stored = before.hashActive(T.EMAIL, 'a@b.co'); // guardado con v1
      const candidates = after.hashAll(T.EMAIL, 'a@b.co');

      expect(after.hashActive(T.EMAIL, 'a@b.co').keyVersion).toBe(2);
      expect(candidates.map((c) => c.keyVersion)).toEqual([2, 1]);
      // La exclusión hecha con la llave vieja sigue encontrándose.
      expect(candidates).toContainEqual(stored);
    });

    it('llaves distintas dan hashes distintos', () => {
      const s = service(`1:${KEY_1},2:${KEY_2}`, 2);
      const [v2, v1] = s.hashAll(T.EMAIL, 'a@b.co');
      expect(v2.hash).not.toBe(v1.hash);
    });
  });

  describe('configuración inválida falla en el arranque', () => {
    it.each([
      ['', 1, 'No hay llaves'],
      [`1:${Buffer.alloc(8).toString('base64')}`, 1, 'al menos 32 bytes'],
      [`1:${KEY_1}`, 2, 'versión activa'],
      [`1:${KEY_1},1:${KEY_2}`, 1, 'repetida'],
      [`x:${KEY_1}`, 1, 'inválida'],
    ])('%p activa=%p', (keys, active, message) => {
      expect(() => service(keys, active)).toThrow(message as string);
    });
  });

  it('un identificador inválido se rechaza', () => {
    expect(() =>
      service(`1:${KEY_1}`, 1).hashActive(T.EMAIL, 'no-es-correo'),
    ).toThrow('no es válido');
  });
});

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { HealthController, readAppVersion } from './health.controller';

describe('HealthController', () => {
  it('responde ok con la versión de package.json', () => {
    const { version: expected } = jest.requireActual<{ version: string }>(
      '../../../package.json',
    );

    const body = new HealthController().check();

    expect(body.status).toBe('ok');
    expect(body.version).toBe(expected);
    expect(typeof body.timestamp).toBe('string');
  });

  describe('readAppVersion', () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'health-'));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('lee la versión del package.json del directorio dado', () => {
      writeFileSync(join(dir, 'package.json'), '{"version":"9.8.7"}');
      expect(readAppVersion(dir)).toBe('9.8.7');
    });

    it('devuelve "unknown" si no hay package.json', () => {
      expect(readAppVersion(dir)).toBe('unknown');
    });

    it('devuelve "unknown" si el package.json no trae versión', () => {
      writeFileSync(join(dir, 'package.json'), '{"name":"x"}');
      expect(readAppVersion(dir)).toBe('unknown');
    });
  });
});

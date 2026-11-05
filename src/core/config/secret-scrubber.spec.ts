import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import {
  redactSecrets,
  resetSecretScrubberForTests,
  ScrubbingConsoleLogger,
  scrubSecrets,
  secretValuesFrom,
} from './secret-scrubber';
import { R2StorageService } from '../infrastructure/r2/r2.service';

// Valores de prueba: no son llaves reales.
const FAKE = {
  R2_ACCOUNT_ID: 'acct-prueba-000000000000',
  R2_ACCESS_KEY_ID: 'AKIAPRUEBA0000000000',
  R2_SECRET_ACCESS_KEY: 'secreto-de-prueba-r2-0000000000000000',
  R2_BUCKET_NAME: 'bucket-prueba',
  JWT_ACCESS_SECRET: 'jwt-de-prueba-0000000000',
  PASSDB_POSTGRES: 'clave-db-prueba',
  GROWTH_SUPPRESSION_HMAC_KEYS:
    '1:aG1hYy11bm8tcHJ1ZWJhLTAwMDAwMDAw,2:aG1hYy1kb3MtcHJ1ZWJhLTAwMDAwMDAw',
  PORT: '3001',
  NODE_ENV: 'test',
};

describe('Depurador de secretos', () => {
  it('toma solo las variables secretas, y cada llave de una lista por separado', () => {
    const values = secretValuesFrom(FAKE);
    expect(values).toEqual(
      expect.arrayContaining([
        FAKE.R2_ACCOUNT_ID,
        FAKE.R2_ACCESS_KEY_ID,
        FAKE.R2_SECRET_ACCESS_KEY,
        FAKE.JWT_ACCESS_SECRET,
        FAKE.PASSDB_POSTGRES,
        'aG1hYy11bm8tcHJ1ZWJhLTAwMDAwMDAw',
        'aG1hYy1kb3MtcHJ1ZWJhLTAwMDAwMDAw',
      ]),
    );
    expect(values).not.toContain(FAKE.R2_BUCKET_NAME);
    expect(values).not.toContain(FAKE.PORT);
    expect(values).not.toContain(FAKE.NODE_ENV);
  });

  it('reemplaza cada aparición, también dentro de otro texto', () => {
    const secrets = secretValuesFrom(FAKE);
    const text = `secretAccessKey ${FAKE.R2_SECRET_ACCESS_KEY} y accessKeyId=${FAKE.R2_ACCESS_KEY_ID}; otra vez ${FAKE.R2_SECRET_ACCESS_KEY}`;
    const out = redactSecrets(text, secrets);
    expect(out).not.toContain(FAKE.R2_SECRET_ACCESS_KEY);
    expect(out).not.toContain(FAKE.R2_ACCESS_KEY_ID);
    expect(out).toBe(
      'secretAccessKey [redactado] y accessKeyId=[redactado]; otra vez [redactado]',
    );
  });

  it('no toca textos sin secretos', () => {
    expect(
      redactSecrets('Archivo subido a R2: a/b.png', secretValuesFrom(FAKE)),
    ).toBe('Archivo subido a R2: a/b.png');
  });

  describe('con process.env', () => {
    const saved = { ...process.env };
    beforeEach(() => {
      Object.assign(process.env, FAKE);
      resetSecretScrubberForTests();
    });
    afterEach(() => {
      process.env = { ...saved };
      resetSecretScrubberForTests();
    });

    it('el logger de la app nunca imprime el valor, ni en el mensaje ni en la traza', () => {
      const written: string[] = [];
      const out = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk: string | Uint8Array) => {
          written.push(String(chunk));
          return true;
        });
      const err = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation((chunk: string | Uint8Array) => {
          written.push(String(chunk));
          return true;
        });
      try {
        const logger = new ScrubbingConsoleLogger('Prueba', { colors: false });
        logger.warn(`secretAccessKey ${FAKE.R2_SECRET_ACCESS_KEY}`);
        logger.error(
          `falló con ${FAKE.JWT_ACCESS_SECRET}`,
          `Error: ${FAKE.PASSDB_POSTGRES}\n    at x`,
        );
      } finally {
        out.mockRestore();
        err.mockRestore();
      }
      const all = written.join('');
      expect(all).toContain('secretAccessKey [redactado]');
      for (const v of [
        FAKE.R2_SECRET_ACCESS_KEY,
        FAKE.JWT_ACCESS_SECRET,
        FAKE.PASSDB_POSTGRES,
      ]) {
        expect(all).not.toContain(v);
      }
    });

    it('scrubSecrets lee el entorno del proceso', () => {
      expect(scrubSecrets(`x ${FAKE.R2_ACCESS_KEY_ID} y`)).toBe(
        'x [redactado] y',
      );
    });
  });
});

describe('R2StorageService al arrancar', () => {
  it('no registra ninguna credencial de R2 (regresión del 2026-08-01)', () => {
    const lines: string[] = [];
    const spies = (['log', 'warn', 'debug', 'error', 'verbose'] as const).map(
      (level) =>
        jest
          .spyOn(Logger.prototype, level)
          .mockImplementation((...args: unknown[]) => {
            lines.push(args.map(String).join(' '));
          }),
    );
    try {
      const config = new ConfigService({
        r2: {
          accountId: FAKE.R2_ACCOUNT_ID,
          accessKeyId: FAKE.R2_ACCESS_KEY_ID,
          secretAccessKey: FAKE.R2_SECRET_ACCESS_KEY,
          bucketName: FAKE.R2_BUCKET_NAME,
          publicUrl: 'files.alternaqj.com',
          appName: 'entrylink',
        },
      });
      new R2StorageService(config).onModuleInit();
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
    const all = lines.join('\n');
    expect(lines.length).toBeGreaterThan(0);
    expect(all).not.toContain(FAKE.R2_ACCOUNT_ID);
    expect(all).not.toContain(FAKE.R2_ACCESS_KEY_ID);
    expect(all).not.toContain(FAKE.R2_SECRET_ACCESS_KEY);
  });
});

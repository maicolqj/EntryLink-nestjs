import { envValidationSchema, validateEnv } from './env-validation';
import { redactValues } from './redact';

/** Variables de la Growth Suite: apagada por defecto y sin romper el arranque. */
const BASE = {
  NODE_ENV: 'development',
  DB_HOST: 'localhost',
  DB_USERNAME: 'postgres',
  DB_NAME: 'test',
  PASSDB_POSTGRES: 'x',
  REDIS_HOST: 'localhost',
  REDIS_PASSWORD: 'x',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  JWT_ISSUER: 'test',
  FINGERPRINT_SECRET: 'c'.repeat(32),
};
const KEY = Buffer.alloc(32, 1).toString('base64');

const validate = (env: Record<string, string>) =>
  envValidationSchema.validate({ ...BASE, ...env }, { abortEarly: false });

describe('Variables de entorno de la Growth Suite', () => {
  it('sin variables: válido y apagada', () => {
    const { error, value } = validate({});
    expect(error).toBeUndefined();
    expect(value.GROWTH_ENABLED).toBe(false);
  });

  it('variables vacías (docker compose sin definirlas) no rompen el arranque', () => {
    const { error, value } = validate({
      GROWTH_ENABLED: '',
      GROWTH_SUPPRESSION_HMAC_KEYS: '',
      GROWTH_SUPPRESSION_HMAC_ACTIVE_VERSION: '',
    });
    expect(error).toBeUndefined();
    expect(value.GROWTH_ENABLED).toBe(false);
  });

  it('encendida sin llaves HMAC: falla al arrancar', () => {
    const { error } = validate({ GROWTH_ENABLED: 'true' });
    expect(error?.message).toMatch(/GROWTH_SUPPRESSION_HMAC_KEYS/);
    expect(error?.message).toMatch(/GROWTH_SUPPRESSION_HMAC_ACTIVE_VERSION/);
  });

  it('encendida con llavero versionado: válido', () => {
    const { error } = validate({
      GROWTH_ENABLED: 'true',
      GROWTH_SUPPRESSION_HMAC_KEYS: `1:${KEY},2:${KEY}`,
      GROWTH_SUPPRESSION_HMAC_ACTIVE_VERSION: '2',
    });
    expect(error).toBeUndefined();
  });

  it('llave con formato inválido: falla', () => {
    const { error } = validate({
      GROWTH_ENABLED: 'true',
      GROWTH_SUPPRESSION_HMAC_KEYS: 'clave-sin-version',
      GROWTH_SUPPRESSION_HMAC_ACTIVE_VERSION: '1',
    });
    expect(error?.message).toMatch(/GROWTH_SUPPRESSION_HMAC_KEYS/);
  });

  it('apagada: un formato inválido en las variables de la suite NO impide arrancar y se descartan', () => {
    const { error, value } = validate({
      GROWTH_ENABLED: 'false',
      GROWTH_SUPPRESSION_HMAC_KEYS: `1=${KEY}`,
      GROWTH_SUPPRESSION_HMAC_ACTIVE_VERSION: 'uno',
    });
    expect(error).toBeUndefined();
    expect(value).not.toHaveProperty('GROWTH_SUPPRESSION_HMAC_KEYS');
    expect(value).not.toHaveProperty('GROWTH_SUPPRESSION_HMAC_ACTIVE_VERSION');
  });
});

describe('validateEnv: los errores de configuración no exponen valores', () => {
  const secret = `1=${KEY}`;

  it('el caso del 2026-11-01 ("1=" en vez de "1:"): nombra la variable, nunca el valor', () => {
    expect(() =>
      validateEnv({
        ...BASE,
        GROWTH_ENABLED: 'true',
        GROWTH_SUPPRESSION_HMAC_KEYS: secret,
        GROWTH_SUPPRESSION_HMAC_ACTIVE_VERSION: '1',
      }),
    ).toThrow(/GROWTH_SUPPRESSION_HMAC_KEYS no tiene el formato esperado/);
    try {
      validateEnv({
        ...BASE,
        GROWTH_ENABLED: 'true',
        GROWTH_SUPPRESSION_HMAC_KEYS: secret,
        GROWTH_SUPPRESSION_HMAC_ACTIVE_VERSION: '1',
      });
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain(KEY);
      expect(msg).not.toMatch(/with value/);
    }
  });

  it('secretos cortos o ausentes tampoco salen en el mensaje', () => {
    const shortSecret = 'corto-y-secreto';
    let msg = '';
    try {
      validateEnv({
        ...BASE,
        JWT_ACCESS_SECRET: shortSecret,
        REDIS_PASSWORD: undefined,
      });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/JWT_ACCESS_SECRET es demasiado corta/);
    expect(msg).toMatch(/REDIS_PASSWORD es obligatoria/);
    expect(msg).not.toContain(shortSecret);
  });

  it('entorno válido: devuelve los valores con sus valores por defecto', () => {
    const value = validateEnv({ ...BASE });
    expect(value.GROWTH_ENABLED).toBe(false);
    expect(value.PORT).toBe(3001);
  });
});

describe('redactValues (defensa en Sentry)', () => {
  it('quita el valor de un mensaje estilo Joi y deja el resto', () => {
    const msg = `Config validation error: "GROWTH_SUPPRESSION_HMAC_KEYS" with value "1=${KEY}" fails to match the required pattern`;
    const out = redactValues(msg);
    expect(out).not.toContain(KEY);
    expect(out).toContain('with value "[redactado]"');
    expect(out).toContain('GROWTH_SUPPRESSION_HMAC_KEYS');
    expect(redactValues("x with value 'abc' y")).toBe(
      "x with value '[redactado]' y",
    );
    expect(redactValues('sin valores')).toBe('sin valores');
  });
});

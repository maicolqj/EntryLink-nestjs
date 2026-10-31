import { envValidationSchema } from './env-validation';

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
});

import * as Joi from 'joi';

const prodRequired = (schema: Joi.Schema) =>
  schema.when('NODE_ENV', {
    is: 'production',
    then: schema.required(),
    otherwise: schema.optional(),
  });

export const envValidationSchema = Joi.object({
  // ── Entorno ────────────────────────────────────────────────────────────────
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  PORT: Joi.number().integer().min(1).max(65535).default(3001),
  TZ: Joi.string().default('America/Bogota'),

  // ── Base de datos (requerido en todos los entornos) ────────────────────────
  DB_HOST:         Joi.string().required(),
  DB_PORT:         Joi.number().integer().default(5432),
  DB_USERNAME:     Joi.string().required(),
  DB_NAME:         Joi.string().required(),
  PASSDB_POSTGRES: Joi.string().required(),

  // ── Redis (requerido en todos los entornos) ────────────────────────────────
  REDIS_HOST:      Joi.string().required(),
  REDIS_PORT:      Joi.number().integer().default(6379),
  REDIS_PASSWORD:  Joi.string().required(),
  REDIS_DB:        Joi.number().integer().default(0),
  REDIS_QUEUE_DB:  Joi.number().integer().default(1),
  REDIS_SOCKET_DB: Joi.number().integer().default(6),
  REDIS_PREFIX:    Joi.string().default('app:'),

  // ── JWT (requerido en todos los entornos) ─────────────────────────────────
  JWT_ACCESS_SECRET:  Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ISSUER:         Joi.string().required(),

  // Expiración de tokens (formato: número + s|m|h|d, ej. '15m', '7d')
  JWT_ACCESS_EXPIRY:          Joi.string().pattern(/^\d+[smhd]$/).default('15m'),
  JWT_REFRESH_EXPIRY:         Joi.string().pattern(/^\d+[smhd]$/).default('7d'),
  JWT_REFRESH_EXPIRY_REMEMBER: Joi.string().pattern(/^\d+[smhd]$/).default('30d'),

  // ── Auth (requerido en todos los entornos) ────────────────────────────────
  FINGERPRINT_SECRET: Joi.string().min(32).required(),
  BCRYPT_ROUNDS:      Joi.number().integer().min(10).max(14).default(12),

  // ── CORS ── requerido en prod, default permisivo en dev ───────────────────
  ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),

  // ── Mail (solo requerido en producción) ───────────────────────────────────
  MAIL_HOST:     prodRequired(Joi.string()),
  MAIL_PORT:     prodRequired(Joi.number().integer()),
  MAIL_USER:     prodRequired(Joi.string()),
  MAIL_PASSWORD: prodRequired(Joi.string()),
  MAIL_FROM:     prodRequired(Joi.string()),

  // ── Web Push / VAPID (solo requerido en producción) ───────────────────────
  VAPID_PUBLIC_KEY:  prodRequired(Joi.string()),
  VAPID_PRIVATE_KEY: prodRequired(Joi.string()),

  // ── Cloudflare R2 (solo requerido en producción) ──────────────────────────
  R2_ACCOUNT_ID:        prodRequired(Joi.string()),
  R2_ACCESS_KEY_ID:     prodRequired(Joi.string()),
  R2_SECRET_ACCESS_KEY: prodRequired(Joi.string()),
  R2_BUCKET_NAME:       prodRequired(Joi.string()),
  R2_PUBLIC_URL:        Joi.string().allow('').optional(),

  // ── Bull Board (solo requerido en producción) ─────────────────────────────
  BULL_BOARD_USER: prodRequired(Joi.string()),
  BULL_BOARD_PASS: prodRequired(Joi.string().min(12)),

  // ── BullMQ opcionales ─────────────────────────────────────────────────────
  BULL_REMOVE_ON_COMPLETE: Joi.number().integer().default(10),
  BULL_REMOVE_ON_FAIL:     Joi.number().integer().default(5),
  BULL_ATTEMPTS:           Joi.number().integer().default(3),

  // ── Trusted Documents sync (solo requerido en producción) ─────────────────
  GRAPHQL_SYNC_SECRET: prodRequired(Joi.string().min(32)),
})
  .options({ allowUnknown: true }); // permite vars de OS que no son del proyecto

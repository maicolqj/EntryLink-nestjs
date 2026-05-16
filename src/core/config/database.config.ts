// src/config/database.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('database', () => ({

  type: 'postgres' as const,
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.PASSDB_POSTGRES,
  // VULN-17 fix: falla explícitamente si DB_NAME no está definido
  database: process.env.DB_NAME ?? (() => { throw new Error('DB_NAME env var is required'); })(),

  // 📁 CONFIGURACIÓN DE ENTIDADES Y MIGRACIONES
  entities: [__dirname + '/../**/*.entity{.ts,.js}'], // 📄 Busca todas las entidades en el proyecto
  migrations: [__dirname + '/../migrations/*{.ts,.js}'], // 🔄 Archivos de migración de BD
  autoLoadEntities: true,
  synchronize: false,
  // VULN-03 fix: SSL habilitado en producción para cifrar tráfico con la BD
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: true }
    : false,

  // 🚀 CONFIGURACIÓN AVANZADA PARA PostgreSQL 17
  extra: {
    max: 20,                    // 🔢 Máximo 20 conexiones simultáneas en el pool
    idleTimeoutMillis: 30000,   // ⏱️ Cierra conexiones inactivas después de 30 segundos
    connectionTimeoutMillis: 2000, // ⏱️ Timeout de 2 segundos para nuevas conexiones
  },

  // Query cache con Redis — opt-in por query: find({ cache: true }) o find({ cache: { id: 'key', milliseconds: 60000 } })
  // Solo activo en producción; en dev TypeORM siempre va a la BD para ver cambios en tiempo real
  cache: process.env.NODE_ENV === 'production' ? {
    type: 'ioredis' as const,
    options: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT, 10) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      db: 7,
      keyPrefix: 'typeorm:cache:',
    },
    duration: 60_000,
    ignoreErrors: true,
  } : false,

}));

// 🎯 CÓMO SE USA:
// 1. Se importa en app.module.ts
// 2. ConfigService lo inyecta en TypeOrmModule
// 3. TypeORM usa esta configuración para conectarse a PostgreSQL en Docker
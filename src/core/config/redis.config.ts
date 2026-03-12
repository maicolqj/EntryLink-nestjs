import { registerAs } from '@nestjs/config';

// 🔗 Tipos para TypeScript
export interface RedisConnectionConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  keyPrefix?: string;
  connectTimeout?: number;
  commandTimeout?: number;
  retryAttempts?: number;
  retryDelay?: number | ((times: number) => number);
  maxRetriesPerRequest?: number;
  ttl?: number;
  description?: string;
  enableAutoPipelining?: boolean;
  enableReadyCheck?: boolean;
  keepAlive?: number;
  family?: 4 | 6;
  lazyConnect?: boolean;
  enableOfflineQueue?: boolean;
  maxLoadingTimeout?: number;
}

export interface RedisModuleConfig {
  default: RedisConnectionConfig;
  queue: RedisConnectionConfig;
  connections: Record<string, RedisConnectionConfig>;
  modules: Record<string, any>;
  isDevelopment: boolean;
  isProduction: boolean;
  environment: Record<string, RedisConnectionConfig>;
}

export default registerAs('redis', (): RedisModuleConfig => {
  // 📋 Validación de variables de entorno críticas
  const requiredEnvVars = ['REDIS_HOST'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0 && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required Redis environment variables: ${missingVars.join(', ')}`);
  }

  // 🔧 Configuración base compartida y optimizada para BullMQ
  const baseConfig: Partial<RedisConnectionConfig> = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,

    // ⏱️ Timeouts AUMENTADOS para BullMQ (especialmente en Docker)
    connectTimeout: 60000, // 30 segundos - AUMENTADO
    commandTimeout: 30000, // 15 segundos - AUMENTADO
    maxLoadingTimeout: 10000, // 10 segundos - AUMENTADO

    // 🔄 Configuración de reintentos mejorada para BullMQ
    retryAttempts: 5, // AUMENTADO para mayor tolerancia
    retryDelay: (times: number) => Math.min(times * 100, 3000), // Delay más progresivo
    maxRetriesPerRequest: null, // BullMQ maneja esto

    // 🚀 Optimizaciones de performance para BullMQ
    enableAutoPipelining: false,
    enableReadyCheck: false, // BullMQ maneja esto
    enableOfflineQueue: false,

    // 🌐 Configuración de red optimizada
    family: 4, // IPv4
    keepAlive: 60000, // AUMENTADO a 60 segundos
    lazyConnect: true,
  };

  // 🎯 Configuración principal para la aplicación
  const defaultConfig: RedisConnectionConfig = {
    ...baseConfig,
    db: parseInt(process.env.REDIS_DB, 10) || 0,
    keyPrefix: process.env.REDIS_PREFIX || 'app:',
    description: 'Configuración principal de Redis para la aplicación',
  } as RedisConnectionConfig;

  // 📦 Configuración específica para BullMQ (colas de trabajos)
  const queueConfig: RedisConnectionConfig = {
    ...baseConfig,
    db: parseInt(process.env.REDIS_QUEUE_DB, 10) || 1,
    keyPrefix: '', // BullMQ maneja sus propios prefijos
    description: 'Configuración para BullMQ - colas de trabajos',

    // ⚠️ Configuraciones específicas para BullMQ - TIMEOUTS AUMENTADOS
    enableAutoPipelining: false,
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
    lazyConnect: false, // CAMBIADO: false para conexión inmediata en BullMQ
    connectTimeout: 30000, // 30 segundos
    commandTimeout: 15000, // 15 segundos
  } as RedisConnectionConfig;

  return {
    // 🔗 Configuraciones principales
    default: defaultConfig,
    queue: queueConfig,

    // 🏢 Configuraciones por caso de uso específico
    connections: {
      // Cache general de aplicación
      cache: {
        ...baseConfig,
        db: 0,
        keyPrefix: 'cache:',
        description: 'Cache general de aplicación',
        ttl: 3600,
      } as RedisConnectionConfig,

      // Sesiones de usuarios
      session: {
        ...baseConfig,
        db: 2,
        keyPrefix: 'session:',
        description: 'Sesiones de usuarios',
        ttl: 86400,
        enableAutoPipelining: false,
      } as RedisConnectionConfig,

      // Colas de trabajos (BullMQ)
      jobs: {
        ...baseConfig,
        db: 1,
        keyPrefix: '',
        description: 'BullMQ - Colas de trabajos',
        maxRetriesPerRequest: null,
        enableAutoPipelining: false,
        enableReadyCheck: false,
        lazyConnect: false, // CAMBIADO para BullMQ
        connectTimeout: 30000, // AUMENTADO
        commandTimeout: 15000, // AUMENTADO
      } as RedisConnectionConfig,

      // Distributed locks
      locks: {
        ...baseConfig,
        db: 3,
        keyPrefix: 'lock:',
        description: 'Distributed locks',
        ttl: 300,
        commandTimeout: 5000, // AUMENTADO
        enableAutoPipelining: false,
      } as RedisConnectionConfig,

      // Métricas y contadores
      metrics: {
        ...baseConfig,
        db: 4,
        keyPrefix: 'metrics:',
        description: 'Métricas y contadores',
        ttl: 3600,
      } as RedisConnectionConfig,

      // Rate limiting
      rateLimit: {
        ...baseConfig,
        db: 5,
        keyPrefix: 'rate:',
        description: 'Rate limiting',
        ttl: 3600,
        commandTimeout: 5000, // AUMENTADO
      } as RedisConnectionConfig,

      // Pub/Sub para eventos en tiempo real
      pubsub: {
        ...baseConfig,
        db: 6,
        keyPrefix: 'pubsub:',
        description: 'Pub/Sub y eventos en tiempo real',
        enableOfflineQueue: true,
        lazyConnect: false,
      } as RedisConnectionConfig,
    },

    // 🔧 Configuraciones para diferentes módulos de NestJS
    modules: {
      // Para @nestjs-modules/ioredis
      ioredis: {
        ...defaultConfig,
        type: 'single',
        url: process.env.REDIS_PASSWORD
          ? `redis://:${process.env.REDIS_PASSWORD}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`
          : `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`,
        options: {
          ...baseConfig,
          db: parseInt(process.env.REDIS_DB, 10) || 0,
          keyPrefix: process.env.REDIS_PREFIX || 'app:',
        },
      },

      // Para @liaoliaots/nestjs-redis
      nestjsRedis: {
        config: {
          ...defaultConfig,
          url: process.env.REDIS_PASSWORD
            ? `redis://:${process.env.REDIS_PASSWORD}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`
            : `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`,
        },
      },

      // ⚠️ CONFIGURACIÓN ESPECÍFICA PARA @nestjs/bullmq (BullMQ) - CORREGIDA
      bullmq: {
        // Configuración de conexión Redis para BullMQ
        connection: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT, 10) || 6379,
          password: process.env.REDIS_PASSWORD || undefined,
          db: parseInt(process.env.REDIS_QUEUE_DB, 10) || 1,

          // ⚠️ Configuraciones específicas para BullMQ - TIMEOUTS AUMENTADOS
          maxRetriesPerRequest: null, // BullMQ SÍ usa esto
          enableReadyCheck: false,
          lazyConnect: false, // CAMBIADO: false para conexión inmediata
          connectTimeout: 30000, // AUMENTADO a 30 segundos
          commandTimeout: 15000, // AUMENTADO a 15 segundos
          family: 4,
          retryDelayOnFailover: 500, // AUMENTADO
          keepAlive: 60000, // AUMENTADO

          // 🔄 Configuración de reintentos específica para BullMQ
          retryAttempts: 5,
          retryDelay: (times: number) => Math.min(times * 200, 5000),

          // 🐛 Configuraciones adicionales para debugging
          showFriendlyErrorStack: process.env.NODE_ENV === 'development',
        },

        // Configuraciones de trabajos por defecto para BullMQ
        defaultJobOptions: {
          removeOnComplete: parseInt(process.env.BULL_REMOVE_ON_COMPLETE, 10) || 10,
          removeOnFail: parseInt(process.env.BULL_REMOVE_ON_FAIL, 10) || 5,
          attempts: parseInt(process.env.BULL_ATTEMPTS, 10) || 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          // ⏱️ Timeout para trabajos individuales
          timeout: 60000, // 60 segundos para trabajos
        },
      },
    },

    // 🌍 Configuración por entorno
    environment: {
      // Desarrollo - CONFIGURACIÓN MEJORADA PARA DOCKER
      development: {
        ...baseConfig,
        db: 0,
        keyPrefix: 'dev:',
        enableAutoPipelining: false,
        enableReadyCheck: false,
        maxRetriesPerRequest: 10, // Para compatibilidad con BullMQ
        lazyConnect: true, // CAMBIADO para desarrollo
        connectTimeout: 60000, // AUMENTADO para Docker
        commandTimeout: 15000, // AUMENTADO para Docker
        keepAlive: 60000,
        description: 'Configuración para desarrollo con Docker',
      } as RedisConnectionConfig,

      // Testing
      test: {
        ...baseConfig,
        db: 15,
        keyPrefix: 'test:',
        enableAutoPipelining: false,
        lazyConnect: false,
        connectTimeout: 10000,
        commandTimeout: 5000,
        description: 'Configuración para testing',
      } as RedisConnectionConfig,

      // Producción
      production: {
        ...baseConfig,
        enableAutoPipelining: false,
        connectTimeout: 30000, // AUMENTADO
        commandTimeout: 20000, // AUMENTADO para producción
        maxRetriesPerRequest: null,
        lazyConnect: false, // CAMBIADO para producción
        description: 'Configuración optimizada para producción con BullMQ',
      } as RedisConnectionConfig,
    },

    // 🏷️ Flags de entorno
    isDevelopment: process.env.NODE_ENV === 'development',
    isProduction: process.env.NODE_ENV === 'production',
  };
});

// 🔧 Función helper para obtener configuración por entorno
export const getRedisConfigForEnvironment = (config: RedisModuleConfig) => {
  const env = process.env.NODE_ENV || 'development';
  return config.environment[env] || config.environment.development;
};

// 🔧 Función helper para validar configuración
export const validateRedisConfig = (config: RedisConnectionConfig): boolean => {
  const required = ['host', 'port'];
  return required.every(key => config[key] !== undefined && config[key] !== null);
};

// 🔧 Función helper para testing de conexión Redis
export const testRedisConnection = async (config: RedisConnectionConfig): Promise<boolean> => {
  const Redis = require('ioredis');
  const redis = new Redis(config);

  try {
    const result = await redis.ping();
    await redis.disconnect();
    return result === 'PONG';
  } catch (error: any) {
    console.error('Redis connection test failed:', error.message);
    return false;
  }
};

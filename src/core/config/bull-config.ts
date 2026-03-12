import { BullModule } from '@nestjs/bullmq';
import { Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { RedisModuleConfig } from '../config/redis.config';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const logger = new Logger('BullConfigModule');
        
        try {
          // Obtener configuración completa de Redis
          const redisConfig: RedisModuleConfig = configService.get('redis');
          
          if (!redisConfig) {
            throw new Error('Redis configuration not found');
          }
          
          // Usar configuración específica de BullMQ desde redis.config
          const bullmqConfig = redisConfig.modules.bullmq;
          
          // 🔍 Log detallado de configuración para debugging
          logger.log('🔧 BullMQ Redis Configuration:', JSON.stringify({
            host: bullmqConfig.connection.host,
            port: bullmqConfig.connection.port,
            db: bullmqConfig.connection.db,
            hasPassword: !!bullmqConfig.connection.password,
            connectTimeout: bullmqConfig.connection.connectTimeout,
            commandTimeout: bullmqConfig.connection.commandTimeout,
            lazyConnect: bullmqConfig.connection.lazyConnect,
            maxRetriesPerRequest: bullmqConfig.connection.maxRetriesPerRequest,
            enableReadyCheck: bullmqConfig.connection.enableReadyCheck,
            retryAttempts: bullmqConfig.connection.retryAttempts,
          }, null, 2));

          // 🧪 Validación de configuración crítica
          const requiredFields = ['host', 'port'];
          const missingFields = requiredFields.filter(field => !bullmqConfig.connection[field]);
          
          if (missingFields.length > 0) {
            throw new Error(`Missing required BullMQ connection fields: ${missingFields.join(', ')}`);
          }

          // 🔧 Configuración final para BullMQ
          const finalConfig = {
            // ⚠️ IMPORTANTE: Para BullMQ usar 'connection' no 'redis'
            connection: {
              ...bullmqConfig.connection,
              
              // 🔄 Callbacks de eventos para debugging
              retryDelayOnFailover: bullmqConfig.connection.retryDelayOnFailover || 500,
              
              // 🐛 Eventos de debugging en desarrollo
              ...(process.env.NODE_ENV === 'development' && {
                onError: (error: Error) => {
                  logger.error('Redis connection error:', error.message);
                },
                onConnect: () => {
                  logger.log('✅ Redis connected successfully for BullMQ');
                },
                onReconnecting: () => {
                  logger.warn('🔄 Redis reconnecting...');
                },
                onClose: () => {
                  logger.warn('❌ Redis connection closed');
                },
              }),
            },
            
            // Opciones por defecto para trabajos
            defaultJobOptions: {
              ...bullmqConfig.defaultJobOptions,
              
              // 🕐 Timeout adicional para trabajos en desarrollo
              ...(process.env.NODE_ENV === 'development' && {
                timeout: 120000, // 2 minutos en desarrollo
              }),
            },

            // 🎛️ Configuraciones adicionales de BullMQ
            // settings: {
            //   stalledInterval: 30000, // Verificar trabajos bloqueados cada 30s
            //   maxStalledCount: 3, // Máximo 3 intentos para trabajos bloqueados
              
            //   // 🐛 Configuraciones de debugging
            //   ...(process.env.NODE_ENV === 'development' && {
            //     retryProcessDelay: 2000, // Delay entre reintentos en desarrollo
            //   }),
            // },
          };

          logger.log('🚀 BullMQ module configured successfully');
          return finalConfig;
          
        } catch (error: any) {
          logger.error('❌ Failed to configure BullMQ module:', error.message);
          throw error;
        }
      },
      inject: [ConfigService],
    }),
  ],
  exports: [BullModule],
})
export class BullConfigModule {
  private readonly logger = new Logger(BullConfigModule.name);

  constructor() {
    this.logger.log('📦 BullConfigModule initialized');
  }
}
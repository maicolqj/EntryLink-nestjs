import { Logger, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { GqlThrottlerGuard } from './modules/shared/guards/gql-throttler.guard';
import { PersistedQueriesMiddleware } from './modules/shared/middleware/persisted-queries.middleware';
import { ManifestModule } from './modules/graphql-manifest/manifest.module';
import { GraphQLFormattedError, ValidationRule } from 'graphql';
import type { Request, Response } from 'express';
import { join } from 'node:path';
import depthLimit from 'graphql-depth-limit';
import GraphQLJSON from 'graphql-type-json';
import './core/infrastructure/graphql/date-time.scalar'; // patch GraphQLISODateTime.serialize

import databaseConfig from './core/config/database.config';
import redisConfig from './core/config/redis.config';
import r2Config from './core/config/r2.config';
import { envValidationSchema } from './core/config/env-validation';

import { CacheModule } from './core/infrastructure/cache/cache.module';
import { BullConfigModule } from './core/config/bull-config';
import { R2Module } from './core/infrastructure/r2/r2.module';

import { PermissionsModule } from './modules/permissions/permissions.module';
import { SharedModule } from './modules/shared/shared.module';
import { RolesModule } from './modules/roles/roles.module';
import { SeedModule } from './core/database/seeds/seed.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { ResidentialComplexModule } from './modules/residential-complex/residential-complex.module';
import { ResidentsModule } from './modules/residents/residents.module';
import { VisitorsModule } from './modules/visitors/visitors.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { PackagesModule } from './modules/packages/packages.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { FinanceModule } from './modules/finance/finance.module';
import { VisitorParkingModule } from './modules/visitor-parking/visitor-parking.module';
import { NotesModule } from './modules/notes/notes.module';
import { MessagesModule } from './modules/messages/messages.module';
import { CallLogsModule } from './modules/call-logs/call-logs.module';
import { AuditModule } from './modules/audit/audit.module';
import { SupervisorVisitsModule } from './modules/supervisor-visits/supervisor-visits.module';
import { MailModule } from './mail/mail.module';
import { BullBoardAppModule } from './core/infrastructure/bull-board/bull-board.module';
import { HealthModule } from './modules/health/health.module';
import { SocketModule } from './core/infrastructure/socket/socket.module';
import { SpecialNumbersModule } from './modules/special-numbers/special-numbers.module';

@Module({
  imports: [
    // ── Configuración global ─────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [redisConfig, databaseConfig, r2Config],
      envFilePath: ['.env'],
      expandVariables: true,
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),

    // ── Base de datos ─────────────────────────────────────────────────────
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService): TypeOrmModuleOptions => ({
        ...configService.get<TypeOrmModuleOptions>('database'),
      }),
      inject: [ConfigService],
    }),

    // ── GraphQL ───────────────────────────────────────────────────────────
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProd = config.get<string>('NODE_ENV') === 'production';

        return {
          autoSchemaFile: isProd
            ? join(process.cwd(), 'schema.gql')
            : join(process.cwd(), 'src/schema.gql'),
          buildSchemaOptions: {
            scalarsMap: [{ type: () => GraphQLJSON, scalar: GraphQLJSON }],
          },

          introspection: !isProd,
          playground: !isProd,
          graphiql: !isProd,

          validationRules: [depthLimit(7) as ValidationRule],

          // Trusted-document cache: get resolves from ManifestService (Redis-backed).
          // set and delete are no-ops — only POST /graphql-manifest/sync may update
          // the manifest, preventing dynamic query injection by clients.
          // persistedQueries: {
          //   cache: {
          //     get:    async (key: string): Promise<string | undefined> => manifest.getOperation(key),
          //     set:    async (_k: string, _v: string): Promise<void> => {},
          //     delete: async (_k: string): Promise<boolean | void> => {},
          //   },
          // },

          context: ({ req, res }: { req: Request; res: Response }) => ({
            req,
            res,
          }),
          formatError: (
            formattedError: GraphQLFormattedError,
            error: unknown,
          ) => {
            const gqlError = error as {
              extensions?: {
                code?: string;
                statusCode?: number;
                details?: unknown;
                originalError?: {
                  errorCode?: string;
                  statusCode?: number;
                  details?: unknown;
                };
              };
              originalError?: { stack?: string };
              stack?: string;
            };
            const ext = gqlError?.extensions;
            const originalError = ext?.originalError;
            // El UniversalExceptionFilter escribe code/statusCode/details directo en
            // extensions; Apollo en otros casos los anida en extensions.originalError.
            // Se leen ambas ubicaciones para no perder el status real (antes caía a 500).
            const code =
              originalError?.errorCode ||
              ext?.code ||
              'INTERNAL_SERVER_ERROR';
            const statusCode = originalError?.statusCode ?? ext?.statusCode ?? 500;
            const details = originalError?.details ?? ext?.details ?? '';

            // Observabilidad: loguear server-side el stack real de errores no esperados
            // (Apollo enmascara el mensaje como "Internal server error" hacia el cliente).
            if (!code || statusCode >= 500) {
              const stack = gqlError?.originalError?.stack || gqlError?.stack;
              new Logger('GraphQL').error(
                `${code} en ${JSON.stringify(formattedError.path)}: ${formattedError.message}`,
                stack,
              );
            }

            return {
              message: formattedError.message,
              path: formattedError.path,
              extensions: {
                code,
                statusCode,
                detail: isProd ? '' : details,
                timestamp: new Date().toISOString(),
              },
            };
          },
        };
      },
    }),

    // ── Rate limiting ─────────────────────────────────────────────────────
    ThrottlerModule.forRoot([
      {
        name: 'short', // ráfagas: máx 20 req en 1 s (protege contra flood puntual)
        ttl: 1_000,
        limit: 20,
      },
      {
        name: 'medium', // ventana media: máx 100 req en 10 s
        ttl: 10_000,
        limit: 100,
      },
      {
        name: 'long', // ventana larga: máx 500 req en 1 min
        ttl: 60_000,
        limit: 500,
      },
    ]),

    // ── Tareas programadas (cron) ─────────────────────────────────────────
    ScheduleModule.forRoot(), // Activa los @Cron (finanzas: mora, overdue, causación)

    // ── Infraestructura ───────────────────────────────────────────────────
    CacheModule, // Global — disponible en todos los módulos
    BullConfigModule, // Configura BullMQ con Redis
    R2Module, // Global — almacenamiento de archivos en Cloudflare R2
    SocketModule, // Global — Socket.io con Redis Adapter
    ManifestModule, // Global — trusted-document manifest (Redis-backed)

    // ── Módulos de la aplicación ──────────────────────────────────────────
    SharedModule,
    PermissionsModule,
    RolesModule,
    SeedModule,
    UsersModule,
    AuthModule,
    ResidentialComplexModule,
    ResidentsModule,
    VisitorsModule,
    VehiclesModule,
    PackagesModule,
    NotificationsModule,
    FinanceModule,
    VisitorParkingModule,
    NotesModule,
    MessagesModule,
    CallLogsModule,
    AuditModule,
    SupervisorVisitsModule,
    SpecialNumbersModule,
    MailModule,
    BullBoardAppModule,
    HealthModule,
  ],
  providers: [
    // Aplica rate limiting globalmente a todos los endpoints REST y GraphQL
    { provide: APP_GUARD, useClass: GqlThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(PersistedQueriesMiddleware).forRoutes('/graphql');
  }
}

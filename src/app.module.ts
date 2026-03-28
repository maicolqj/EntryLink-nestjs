import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { GqlThrottlerGuard } from './modules/shared/guards/gql-throttler.guard';
import { PersistedQueriesMiddleware } from './modules/shared/middleware/persisted-queries.middleware';
import { GraphQLFormattedError } from 'graphql';
import { join } from 'node:path';
import depthLimit from 'graphql-depth-limit';

import databaseConfig    from './core/config/database.config';
import redisConfig       from './core/config/redis.config';
import cloudinaryConfig  from './core/config/cloudinary.config';

import { CacheModule }      from './core/infrastructure/cache/cache.module';
import { BullConfigModule } from './core/config/bull-config';
import { CloudinaryModule } from './core/infrastructure/cloudinary/cloudinary.module';

import { PermissionsModule }        from './modules/permissions/permissions.module';
import { SharedModule }             from './modules/shared/shared.module';
import { RolesModule }              from './modules/roles/roles.module';
import { SeedModule }               from './core/database/seeds/seed.module';
import { UsersModule }              from './modules/users/users.module';
import { AuthModule }               from './modules/auth/auth.module';
import { ResidentialComplexModule } from './modules/residential-complex/residential-complex.module';
import { ResidentsModule }          from './modules/residents/residents.module';
import { VisitorsModule }           from './modules/visitors/visitors.module';
import { VehiclesModule }           from './modules/vehicles/vehicles.module';
import { PackagesModule }           from './modules/packages/packages.module';
import { NotificationsModule }      from './modules/notifications/notifications.module';
import { FinanceModule }            from './modules/finance/finance.module';
import { VisitorParkingModule }    from './modules/visitor-parking/visitor-parking.module';
import { NotesModule }            from './modules/notes/notes.module';
import { AuditModule }           from './modules/audit/audit.module';
import { MailModule }             from './mail/mail.module';
import { BullBoardAppModule }     from './core/infrastructure/bull-board/bull-board.module';

@Module({
  imports: [
    // ── Configuración global ─────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [redisConfig, databaseConfig, cloudinaryConfig],
      envFilePath: ['.env'],
      expandVariables: true,
    }),

    // ── Base de datos ─────────────────────────────────────────────────────
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        ...configService.get('database'),
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
          autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
          installSubscriptionHandlers: true,
          subscriptions: { 'graphql-ws': true },

          // ── Seguridad en producción ──────────────────────────────────────
          // Introspección y playground desactivados en prod para no exponer el schema
          introspection: !isProd,
          playground:    !isProd,
          graphiql:      !isProd,

          // ── Depth Limiting ───────────────────────────────────────────────
          // Protege contra queries anidadas maliciosas (p.ej. { users { roles { users { roles ... } } } })
          validationRules: [depthLimit(7)],

          context: ({ req, connection }) => {
            if (req) return { req };
            if (connection) return { user: connection.context?.user };
            return {};
          },
          formatError: (formattedError: GraphQLFormattedError, error: any) => ({
            message: formattedError.message,
            code: error?.extensions?.code || 'INTERNAL_SERVER_ERROR',
            statusCode: error?.extensions?.statusCode || 500,
            detail: error?.extensions?.details || '',
            timestamp: new Date().toISOString(),
            path: formattedError.path,
          }),
        };
      },
    }),

    // ── Rate limiting ─────────────────────────────────────────────────────
    ThrottlerModule.forRoot([
      {
        name:  'short',   // ráfagas: máx 20 req en 1 s (protege contra flood puntual)
        ttl:   1_000,
        limit: 20,
      },
      {
        name:  'medium',  // ventana media: máx 100 req en 10 s
        ttl:   10_000,
        limit: 100,
      },
      {
        name:  'long',    // ventana larga: máx 500 req en 1 min
        ttl:   60_000,
        limit: 500,
      },
    ]),

    // ── Infraestructura ───────────────────────────────────────────────────
    CacheModule,          // Global — disponible en todos los módulos
    BullConfigModule,     // Configura BullMQ con Redis
    CloudinaryModule,     // Global — subida de imágenes

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
    AuditModule,
  ],
  providers: [
    // Aplica rate limiting globalmente a todos los endpoints REST y GraphQL
    { provide: APP_GUARD, useClass: GqlThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(PersistedQueriesMiddleware)
      .forRoutes('/graphql');
  }
}

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLFormattedError } from 'graphql';
import { join } from 'node:path';

import databaseConfig from './core/config/database.config';
import redisConfig from './core/config/redis.config';

import { CacheModule } from './core/infrastructure/cache/cache.module';
import { BullConfigModule } from './core/config/bull-config';

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

@Module({
  imports: [
    // ── Configuración global ─────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [redisConfig, databaseConfig],
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
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      graphiql: true,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      installSubscriptionHandlers: true,
      playground: true,
      introspection: true,
      subscriptions: { 'graphql-ws': true },
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
    }),

    // ── Infraestructura ───────────────────────────────────────────────────
    CacheModule,          // Global — disponible en todos los módulos
    BullConfigModule,     // Configura BullMQ con Redis

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
  ],
})
export class AppModule {}

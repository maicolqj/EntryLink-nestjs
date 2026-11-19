import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { isGrowthEnabled } from './growth.flag';

/**
 * Carga la Growth Suite SOLO con GROWTH_ENABLED=true.
 *
 * No basta con `ConditionalModule.registerWhen(GrowthModule, …)`: importar la
 * clase de forma estática ejecuta los decoradores de todos sus DTOs y
 * resolvers, y Nest publica en el esquema GraphQL los tipos que encuentra
 * referenciados aunque el módulo no se registre. Con el import dinámico, con
 * la bandera apagada el código de la suite ni se carga y el esquema no cambia.
 */
@Module({})
export class GrowthLoaderModule {
  static async register(): Promise<DynamicModule> {
    await ConfigModule.envVariablesLoaded;
    if (!isGrowthEnabled(process.env)) return { module: GrowthLoaderModule };

    const { GrowthModule } = await import('./growth.module');
    return { module: GrowthLoaderModule, imports: [GrowthModule] };
  }
}


import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../../../app.module';
import { SeedService } from '../seed.service';
import { runUserSeed } from '../users.seed';
import { AccountingService } from '../../../../modules/finance/services/accounting.service';



async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const seedService = app.get(SeedService);

  const args = process.argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case 'permissions':
        await seedService.runPermissionsSeed();
        break;

      case 'roles':
        await seedService.runRolesSeed();
        break;

      case 'users':
        await seedService.runUsersSeed();
        break;

      case 'all':
        await seedService.runAllSeeds();
        break;

      case 'puc':
        if (args[1]) {
          await seedService.runPucSeedForComplex(args[1]);
        } else {
          await seedService.runPucSeed();
        }
        break;

      case 'finance-backfill': {
        const accounting = app.get(AccountingService);
        console.log('\n🌱 Backfill de PropertyAccountStatus...');
        const res = await accounting.backfillUnitStatuses(args[1]);
        console.log(`✅ Backfill completado: ${res.processed} unidad(es)\n`);
        break;
      }

      case 'refresh-categories':
        await seedService.refreshCategoriesSeed();
        break;

      case 'clear-categories':
        await seedService.clearCategories();
        break;

      default:
        console.log(`
🌱 Comandos disponibles:

  yarn seed permissions          - Ejecutar seed de permisos
  yarn seed roles                - Ejecutar seed de roles
  yarn seed users                - Ejecutar seed de usuarios
  yarn seed all                  - Ejecutar todos los seeds
  yarn seed puc [complexId]      - Sembrar PUC contable (todas o una copropiedad)
  yarn seed finance-backfill [complexId] - Recalcular PropertyAccountStatus de datos históricos
  yarn seed refresh-categories   - Limpiar y re-crear categorías
  yarn seed clear-categories     - Solo limpiar categorías

Ejemplo:
  yarn seed categories
        `);
    }

    await app.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    await app.close();
    process.exit(1);
  }
}

bootstrap();
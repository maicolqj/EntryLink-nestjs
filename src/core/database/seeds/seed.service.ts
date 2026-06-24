
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { seedPermissions }     from './permissions.seed';
import { seedRoles }           from './roles.seed';
import { runUserSeed }         from './users.seed';
import { seedSpecialNumbers }  from './special-numbers.seed';
import { seedPucForAllComplexes, seedPucForComplex } from './puc.seed';
// import { seedRoles } from './seed-roles';
// import seedSystemCategories from './seed-categories';


@Injectable()
export class SeedService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Ejecutar seed de permisos
   */
  async runPermissionsSeed(): Promise<void> {
    console.log('\n🌱 Ejecutando seed de permisos...');
    await seedPermissions(this.dataSource); 
    console.log('✅ Seed de permisos completado\n');
  }

  /**
   * Ejecutar seed de roles
   */
  async runRolesSeed(): Promise<void> {
    console.log('\n🌱 Ejecutando seed de roles...');
    await seedRoles(this.dataSource);
    console.log('✅ Seed de roles completado\n');
  }

  /**
   * Ejecutar seed de categorías del sistema
   */
  async runUsersSeed(): Promise<void> {
    console.log('\n🌱 Ejecutando seed de usuarios...');
    await runUserSeed(this.dataSource);
    console.log('✅ Seed de usuarios completado\n');
  }

  /**
   * Ejecutar todos los seeds en orden
   */
  async runAllSeeds(): Promise<void> {
    console.log('\n🌱 Iniciando seeds completos...\n');
    
    try {
      await this.runPermissionsSeed();
      await this.runRolesSeed();
      await this.runUsersSeed();
    //   await this.runCategoriesSeed();
      
      console.log('🎉 Todos los seeds ejecutados exitosamente!\n');
    } catch (error) {
      console.error('❌ Error ejecutando seeds:', error);
      throw error;
    }
  }

  /**
   * Ejecutar seed de números especiales globales (creados por SUPER_ADMIN)
   */
  async runSpecialNumbersSeed(): Promise<void> {
    console.log('\n🌱 Ejecutando seed de números especiales globales...');
    await seedSpecialNumbers(this.dataSource);
    console.log('✅ Seed de números especiales completado\n');
  }

  /**
   * Ejecutar seed del PUC contable para todas las copropiedades existentes
   */
  async runPucSeed(): Promise<void> {
    console.log('\n🌱 Ejecutando seed del PUC contable...');
    await seedPucForAllComplexes(this.dataSource);
    console.log('✅ Seed del PUC completado\n');
  }

  /**
   * Ejecutar seed del PUC contable para una copropiedad puntual
   */
  async runPucSeedForComplex(complexId: string): Promise<void> {
    console.log(`\n🌱 Ejecutando seed del PUC para complejo ${complexId}...`);
    await seedPucForComplex(this.dataSource, complexId);
    console.log('✅ Seed del PUC completado\n');
  }

  /**
   * Limpiar todas las categorías (útil para desarrollo)
   */
  async clearCategories(): Promise<void> {
    console.log('\n🗑️  Limpiando categorías...');
    
    await this.dataSource.query('DELETE FROM system_categories');
    
    console.log('✅ Categorías eliminadas\n');
  }

  /**
   * Re-ejecutar seed de categorías (limpiar + crear)
   */
  async refreshCategoriesSeed(): Promise<void> {
    await this.clearCategories();
    // await this.runCategoriesSeed();
  }
}
import { DataSource, In } from 'typeorm';
import { Permission } from '../../../modules/permissions/entities/permission.entity';
import { PERMISSIONS_TO_SEED } from './datas/permissions-data.seed';

/**
 * Seed optimizado de permisos con resolución automática de dependencias por nombre
 */
export const seedPermissions = async (dataSource: DataSource): Promise<void> => {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const permissionRepository = queryRunner.manager.getRepository(Permission);
    
    console.log('🚀 Starting Permission Seeding...');

    // 1. Sincronización de Permisos (Insertar o Actualizar)
    // Usamos el ID fijo que definimos para garantizar consistencia entre entornos
    for (const data of PERMISSIONS_TO_SEED) {
      const existing = await permissionRepository.findOne({ where: { id: data.id } });

      const permissionData = {
        id: data.id,
        name: data.name,
        label: data.label,
        description: data.description,
        group: data.group,
        level: data.level as any,
        isSystem: data.isSystem,
        status: data.status,
      };

      if (!existing) {
        await permissionRepository.save(permissionRepository.create(permissionData));
        console.log(`  ✓ Created: ${data.name}`);
      } else {
        // Actualizamos por si cambiaron labels o descripciones en el archivo seed
        await permissionRepository.update(data.id, permissionData);
      }
    }

    // 2. Resolución de Dependencias
    // Consultamos todos de nuevo para tener las instancias frescas
    const allPermissions = await permissionRepository.find();
    console.log('\n🔗 Linking dependencies...');

    for (const data of PERMISSIONS_TO_SEED) {
      if (!data.dependsOn || data.dependsOn.length === 0) continue;

      const currentPermission = allPermissions.find(p => p.id === data.id);
      
      // Buscamos las instancias de las dependencias basadas en los nombres definidos
      const dependencies = allPermissions.filter(p => 
        data.dependsOn.includes(p.name as any)
      );

      if (currentPermission && dependencies.length > 0) {
        currentPermission.dependsOn = dependencies;
        await permissionRepository.save(currentPermission);
        console.log(`  🔗 ${data.name} -> depends on [${dependencies.map(d => d.name).join(', ')}]`);
      }
    }

    await queryRunner.commitTransaction();
    console.log(`\n✅ Seeding successful: ${allPermissions.length} permissions processed.`);

  } catch (error) {
    console.error('❌ Seeding failed. Rolling back...', error);
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
};
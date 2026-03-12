import { DataSource } from 'typeorm';
import { Role } from '../../../modules/roles/entities/role.entity';
import { Permission } from '../../../modules/permissions/entities/permission.entity';
import { ROLES_TO_SEED } from './datas/roles.data.seed';


export const seedRoles = async (dataSource: DataSource): Promise<void> => {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const roleRepository = queryRunner.manager.getRepository(Role);
    const permissionRepository = queryRunner.manager.getRepository(Permission);

    console.log('🛡️  Starting Role Seeding...');

    // 1. Obtener todos los permisos actuales para mapear por nombre
    const allPermissions = await permissionRepository.find();

    for (const roleData of ROLES_TO_SEED) {
      // Buscar si el rol ya existe
      let role = await roleRepository.findOne({ 
        where: { id: roleData.id },
        relations: ['permissions'] 
      });

      // Filtrar los objetos Permission que coincidan con los nombres en el seed
      const assignedPermissions = allPermissions.filter(p => 
        roleData.permissions.includes(p.name as any)
      );

      if (!role) {
        // Crear nuevo rol con sus relaciones
        role = roleRepository.create({
          id: roleData.id,
          name: roleData.name,
          frontName: roleData.frontName,
          icon: roleData.icon,
          description: roleData.description,
          permissions: assignedPermissions,
        });
        await roleRepository.save(role);
        console.log(`  ✓ Created Role: ${roleData.name} with ${assignedPermissions.length} permissions`);
      } else {
        // Actualizar rol existente y sus permisos
        role.name = roleData.name;
        role.description = roleData.description;
        role.permissions = assignedPermissions;
        await roleRepository.save(role);
        console.log(`  ⚡ Updated Role: ${roleData.name}`);
      }
    }

    await queryRunner.commitTransaction();
    console.log('\n✅ Roles and Permissions association completed!');

  } catch (error) {
    console.error('❌ Role Seeding failed. Rolling back...', error);
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
};
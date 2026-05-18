import { DataSource } from 'typeorm';
import { User } from '../../../modules/users/entities/user.entity';
import { Role } from '../../../modules/roles/entities/role.entity';
import { UserRole } from '../../../modules/users/entities/user_has_roles.entity';
import { ValidRoles } from '../../../modules/roles/enums/valid-roles';
import { USER_TO_SEED } from './datas/users-data.seed';


export const runUserSeed = async (dataSource: DataSource) => {
    const userRepository = dataSource.getRepository(User);
    const roleRepository = dataSource.getRepository(Role);
    const userRoleRepository = dataSource.getRepository(UserRole);

    // 1. Buscamos el rol de Administrador en la BD
    // Asumo que ya corriste un seed previo de Roles o que ya existe.
    const adminRole = await roleRepository.findOneBy({ name: ValidRoles.SUPER_ADMIN_ROL });

    if (!adminRole) {
        throw new Error('El rol ADMIN no existe en la base de datos. Por favor, créalo primero.');
    }

    for (const userData of USER_TO_SEED) {
        // 2. Verificamos si el usuario ya existe para no duplicar
        const exists = await userRepository.findOneBy({ email: userData.email });
        
        if (!exists) {
            // 3. Creamos el usuario
            // Usamos .create() para que se disparen los @BeforeInsert hooks (password hash)
            const newUser = userRepository.create(userData);
            const savedUser = await userRepository.save(newUser);

            // 4. ESTABLECER LA RELACIÓN: Creamos el registro en UserRole
            const newUserRole = userRoleRepository.create({
                user: savedUser,    // Pasamos el objeto usuario recién guardado
                role: adminRole,    // Pasamos el objeto rol que buscamos al inicio
                isPrimary: true,
                assignedAt: new Date(),
            });

            await userRoleRepository.save(newUserRole);
            console.log(`Usuario ${savedUser.email} creado con rol ADMIN.`);
        }
    }
}
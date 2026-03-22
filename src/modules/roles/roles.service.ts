import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { Role } from "./entities/role.entity";

import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, QueryRunner, Repository, SelectQueryBuilder } from "typeorm";
import { Permission } from "../permissions/entities/permission.entity";

import { AssignChildrenResponse, ChangeParentResponse, MoveSubtreeResponse, PaginatedRolesResponse, RemoveRoleResponse, RestoreRoleResponse, RoleHierarchyResponse, SimpleRoleResponse, RoleDetailResponse, PermissionGroupSummary } from "./dto/responses";
import { CreateRoleInput } from "./dto/inputs/create-role.input";
import { SearchRolesInput } from "./dto/inputs/search-roles.input";
import { GraphQLError } from "graphql";
import { AssignedUserRolResponse } from "./dto/responses/assigned-role-user.response";
import { validate, v4 as uuid } from 'uuid';
import { RolesFiltersInput } from "./dto/inputs/roles-filter.input";
import { UpdateRoleInput } from "./dto/inputs/update-role.input";
import { ValidRoles } from "./enums/valid-roles";
import { CustomError } from "../shared/utils/errors.utils";
import { GeneralErrorCode, RolesErrorCode } from "../shared/constans/error-codes.constants";
import { PaginationReponse } from "../shared/dto/responses/pagination-object.response";
import { UserRole } from "../users/entities/user_has_roles.entity";


@Injectable()
export class RolesService {
  private readonly logger: Logger = new Logger(RolesService.name);
  private defaultUserRole: Role;
  private readonly DEFAULT_USER_ROLE_NAME = ValidRoles.RESIDENT_ROL;


  constructor(
    @InjectRepository(Role)
    private readonly rolesRepository: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionsRepository: Repository<Permission>,
    @InjectDataSource()
    private readonly dataSource: DataSource,

  ) { }

  async onModuleInit() {
    this.defaultUserRole = await this.findOrCreateDefaultUserRole();
  }




  private async findOrCreateDefaultUserRole(): Promise<Role> {
    let userRole = await this.rolesRepository.findOne({
      where: { name: this.DEFAULT_USER_ROLE_NAME },
      relations: ['permissions']
    });

    if (!userRole) {
      userRole = this.rolesRepository.create({
        name: this.DEFAULT_USER_ROLE_NAME,
        frontName: 'Usuario',
        description: 'Rol básico para usuarios finales',
        icon: 'person',
        hierarchyLevel: 4,
        status: true,
        isSystem: true
      });
      userRole = await this.rolesRepository.save(userRole);
    }

    return userRole;
  }

  getDefaultUserRole(): Role {
    return this.defaultUserRole;
  }

  // 1. Método para obtener permisos efectivos con herencia inversa
  async getEffectivePermissions(roleId: string): Promise<Permission[]> {
    const role = await this.rolesRepository.findOne({
      where: { id: roleId, status: true },
      relations: ['permissions', 'children', 'children.permissions']
    });

    if (!role) {
      throw new CustomError({
        message: 'Role not found',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: GeneralErrorCode.NOT_FOUND
      });
    }

    // Obtener permisos propios
    const ownPermissions = role.permissions || [];

    // Obtener permisos heredados de roles hijos (recursivamente)
    const inheritedPermissions = await this.getInheritedPermissionsFromChildren(role);

    // Combinar y eliminar duplicados
    const allPermissions = [...ownPermissions, ...inheritedPermissions];
    const uniquePermissions = Array.from(
      new Map(allPermissions.map(p => [p.id, p])).values()
    );

    return uniquePermissions;
  }

  // 2. Método recursivo para obtener permisos de roles hijos
  private async getInheritedPermissionsFromChildren(role: SimpleRoleResponse): Promise<Permission[]> {
    const inheritedPermissions: Permission[] = [];

    // Cargar hijos si no están cargados
    if (!role.children) {
      const roleWithChildren = await this.rolesRepository.findOne({
        where: { id: role.id },
        relations: ['children', 'children.permissions']
      });
      role.children = roleWithChildren?.children || [];
    }

    for (const child of role.children) {
      // Agregar permisos directos del hijo
      if (child.permissions) {
        inheritedPermissions.push(...child.permissions.map(c => ({ ...c } as Permission)));
      }

      // Recursivamente obtener permisos de los nietos
      const grandChildPermissions = await this.getInheritedPermissionsFromChildren(child);
      inheritedPermissions.push(...grandChildPermissions);
    }

    return inheritedPermissions;
  }

  // 3. Modificación del método create para validar herencia inversa
  async create(input: CreateRoleInput ): Promise<Role> {
    // Validaciones existentes...
    await this.validateUniqueName(input.name);
    const permissions = await this.validatePermissions(input.permissionIds);
    const parent = input.parentId
      ? await this.validateParentRole(input.parentId, input.hierarchyLevel)
      : null;
    await this.validateHierarchyLogic(input.hierarchyLevel, parent);

    // 🆕 NUEVA VALIDACIÓN: Verificar que los padres tengan permisos necesarios
    if (parent) {
      await this.validateParentPermissionsForInverseInheritance(parent, permissions);
    }

    const role = this.rolesRepository.create({
      ...input,
      name: input.name,
      description: input.description,
      hierarchyLevel: input.hierarchyLevel,
      isSystem: input.isSystem ?? false,
      metadata: input.metadata ?? {},
      parent,
      permissions,
    });

    try {
      const savedRole = await this.rolesRepository.save(role);

      // 🆕 ACTUALIZAR PERMISOS DE ROLES PADRE (herencia inversa)
      await this.updateParentRolesWithInheritedPermissions(savedRole);

      console.log(`✅ Rol creado: ${savedRole.name} con herencia inversa aplicada`);
      return savedRole;
    } catch (error: any) {
      if (error.code === '23505') {
        throw new CustomError({
          message: `Role with code '${input.name}' already exists`,
          statusCode: HttpStatus.CONFLICT,
          errorCode: RolesErrorCode.ROL_ALREADY_EXISTS,
          details: `Role with code '${input.name}' already exists`
        });
      }
      throw error;
    }
  }

  // 4. Validar que los padres puedan heredar los permisos del hijo
  private async validateParentPermissionsForInverseInheritance(
    parent: Role,
    childPermissions: Permission[]
  ): Promise<void> {
    // Obtener permisos actuales del padre
    const parentWithPermissions = await this.rolesRepository.findOne({
      where: { id: parent.id },
      relations: ['permissions']
    });

    const parentPermissionIds = new Set(
      parentWithPermissions?.permissions?.map(p => p.id) || []
    );

    // Verificar si hay conflictos (opcional, según reglas de negocio)
    const conflictingPermissions = childPermissions.filter(childPerm => {
      // Aquí puedes agregar lógica de conflictos si es necesaria
      // Por ejemplo, si ciertos permisos no pueden coexistir
      return false; // Por ahora, no hay conflictos
    });

    if (conflictingPermissions.length > 0) {
      throw new CustomError({
        message: `Permission conflicts detected for parent role inheritance`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
        details: `Conflicting permissions: ${conflictingPermissions.map(p => p.name).join(', ')}`
      });
    }
  }

  // 5. Actualizar permisos de roles padre cuando se crea un hijo
  private async updateParentRolesWithInheritedPermissions(childRole: Role): Promise<void> {
    if (!childRole.parent) return;

    // Obtener la cadena completa de ancestros
    const ancestors = await this.getAncestorChain(childRole.parent.id);

    for (const ancestor of ancestors) {
      // Recalcular permisos efectivos para cada ancestro
      const effectivePermissions = await this.calculateEffectivePermissionsForRole(ancestor.id);

      // Actualizar la relación muchos a muchos
      ancestor.permissions = effectivePermissions;
      await this.rolesRepository.save(ancestor);

      console.log(`🔄 Actualizado rol padre: ${ancestor.name} con ${effectivePermissions.length} permisos`);
    }
  }

  // 6. Obtener cadena de ancestros
  private async getAncestorChain(roleId: string): Promise<Role[]> {
    const ancestors: Role[] = [];
    let currentRole = await this.rolesRepository.findOne({
      where: { id: roleId },
      relations: ['parent', 'permissions']
    });

    while (currentRole) {
      ancestors.push(currentRole);

      if (currentRole.parent) {
        currentRole = await this.rolesRepository.findOne({
          where: { id: currentRole.parent.id },
          relations: ['parent', 'permissions']
        });
      } else {
        currentRole = null;
      }
    }

    return ancestors;
  }

  // 7. Calcular permisos efectivos para un rol específico
  private async calculateEffectivePermissionsForRole(roleId: string): Promise<Permission[]> {
    const role = await this.rolesRepository.findOne({
      where: { id: roleId },
      relations: ['permissions']
    });

    if (!role) return [];

    // Obtener permisos propios
    const ownPermissions = role.permissions || [];

    // Obtener permisos de todos los descendientes
    const descendantPermissions = await this.getPermissionsFromDescendants(roleId);

    // Combinar y eliminar duplicados
    const allPermissions = [...ownPermissions, ...descendantPermissions];
    const uniquePermissions = Array.from(
      new Map(allPermissions.map(p => [p.id, p])).values()
    );

    return uniquePermissions;
  }

  // 8. Obtener permisos de todos los descendientes
  private async getPermissionsFromDescendants(roleId: string): Promise<Permission[]> {
    const descendants = await this.rolesRepository.find({
      where: { parent: { id: roleId } },
      relations: ['permissions']
    });

    const descendantPermissions: Permission[] = [];

    for (const descendant of descendants) {
      // Agregar permisos directos
      if (descendant.permissions) {
        descendantPermissions.push(...descendant.permissions);
      }

      // Recursivamente obtener permisos de sus hijos
      const grandChildPermissions = await this.getPermissionsFromDescendants(descendant.id);
      descendantPermissions.push(...grandChildPermissions);
    }

    return descendantPermissions;
  }

  // 9. Método para refrescar herencia completa del sistema
  async refreshInverseInheritance(): Promise<void> {
    console.log('🔄 Iniciando actualización de herencia inversa...');

    // Obtener todos los roles ordenados por jerarquía (de mayor a menor nivel)
    const allRoles = await this.rolesRepository.find({
      where: { status: true },
      relations: ['permissions', 'parent'],
      order: { hierarchyLevel: 'DESC' } // Empezar por los niveles más bajos
    });

    // Procesar roles desde los hijos hacia los padres
    for (const role of allRoles) {
      if (role.parent) {
        await this.updateParentRolesWithInheritedPermissions(role);
      }
    }

    console.log('✅ Herencia inversa actualizada completamente');
  }

  // 10. Método utilitario para verificar si un usuario tiene un permiso específico
  // async userHasPermission(userId: string, permissionName: string): Promise<boolean> {
  //   // Obtener roles del usuario
  //   const userRoles = await this.getUserRoles(userId); // Implementar según tu estructura

  //   for (const role of userRoles) {
  //     const effectivePermissions = await this.getEffectivePermissions(role.id);
  //     const hasPermission = effectivePermissions.some(p => p.name === permissionName);

  //     if (hasPermission) {
  //       return true;
  //     }
  //   }

  //   return false;
  // }

  // 11. Ejemplo de uso en un endpoint
  async getRoleWithEffectivePermissions(roleId: string): Promise<{
    role: Role;
    ownPermissions: Permission[];
    inheritedPermissions: Permission[];
    effectivePermissions: Permission[];
  }> {
    const role = await this.rolesRepository.findOne({
      where: { id: roleId },
      relations: ['permissions']
    });

    if (!role) {
      throw new CustomError({
        message: 'Role not found',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: GeneralErrorCode.NOT_FOUND
      });
    }

    const ownPermissions = role.permissions || [];
    const inheritedPermissions = await this.getInheritedPermissionsFromChildren(role);
    const effectivePermissions = await this.getEffectivePermissions(roleId);

    return {
      role,
      ownPermissions,
      inheritedPermissions: inheritedPermissions.filter(
        ip => !ownPermissions.some(op => op.id === ip.id)
      ),
      effectivePermissions
    };
  }

  //**************************************************************************************************************************
  //**************************************************************************************************************************
  //*************************************************************validates***************************************************
  //**************************************************************************************************************************
  //**************************************************************************************************************************


  private async validatePermissions(permissionIds: string[]): Promise<Permission[]> {
    if (!permissionIds || permissionIds.length === 0) {
      throw new CustomError({
        message: `At least one permission is required`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    // Validar que existan los permisos
    const permissions = await this.permissionsRepository.findBy({
      id: In(permissionIds)
    });

    if (permissions.length !== permissionIds.length) {
      const foundIds = permissions.map(p => p.id);
      const missingIds = permissionIds.filter(id => !foundIds.includes(id));
      throw new CustomError({
        message: `Permissions not found: ${missingIds.join(', ')}`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: GeneralErrorCode.NOT_FOUND,
      });
    }

    // Validar que los permisos estén activos
    const inactivePermissions = permissions.filter(p => !p.status);
    if (inactivePermissions.length > 0) {
      const inactiveNames = inactivePermissions.map(p => p.name).join(', ');
      throw new CustomError({
        message: `Cannot assign inactive permissions: ${inactiveNames}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    //! 🔥 VALIDACIÓN CRÍTICA: Restricción de negocio
    // "1 permiso solo puede pertenecer a 1 rol"
    // await this.validatePermissionOwnership(permissionIds);

    // Validar dependencias de permisos
    await this.validatePermissionDependencies(permissions);

    return permissions;
  }

  private async validatePermissionDependencies(permissions: Permission[]): Promise<void> {
    // Cargar dependencias de los permisos
    const permissionsWithDeps = await this.permissionsRepository.find({
      where: { id: In(permissions.map(p => p.id)) },
      relations: ['dependsOn']
    });

    const assignedPermissionNames = new Set(permissions.map(p => p.name));
    const missingDependencies: string[] = [];

    for (const permission of permissionsWithDeps) {
      if (permission.dependsOn && permission.dependsOn.length > 0) {
        for (const dependency of permission.dependsOn) {
          if (!assignedPermissionNames.has(dependency.name)) {
            missingDependencies.push(
              `${permission.name} requires ${dependency.name}`
            );
          }
        }
      }
    }

    if (missingDependencies.length > 0) {

      throw new CustomError({
        message: `Missing required permission dependencies: ${missingDependencies.join(', ')}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }
  }

  private async validateParentRole(parentId: string, childHierarchy: number): Promise<Role> {
    const parent = await this.rolesRepository.findOne({
      where: { id: parentId, status: true } // Solo padres activos
    });

    if (!parent) {
      throw new CustomError({
        message: `Parent role not found or inactive`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: GeneralErrorCode.NOT_FOUND,
      });
    }

    // 🔥 CORRECCIÓN IMPORTANTE: La lógica estaba invertida
    // Un hijo debe tener MAYOR número de jerarquía que el padre
    // Ejemplo: ADMIN (nivel 0) > MANAGER (nivel 1) > USER (nivel 2)
    if (parent.hierarchyLevel >= childHierarchy) {

      throw new CustomError({
        message: `Child role hierarchy level (${childHierarchy}) must be greater than parent level (${parent.hierarchyLevel})`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    return parent;
  }

  private async validateUniqueName(name: ValidRoles): Promise<void> {
    const existingRole = await this.rolesRepository.findOne({
      where: { name }
    });

    if (existingRole) {
      throw new CustomError({
        message: `Role with code '${name}' already exists`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: RolesErrorCode.ROL_ALREADY_EXISTS,
        details: `Role with code '${name}' already exists`
      });
    }
  }

  private async validateHierarchyLogic(hierarchyLevel: number, parent?: Role): Promise<void> {
    // Validar rango de jerarquía
    if (hierarchyLevel < 0 || hierarchyLevel > 10) {
      throw new CustomError({
        message: `Hierarchy level must be between 0 and 4`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
        details: `Hierarchy level must be between 0 and 4`
      });
    }

    // Si no tiene padre, debe ser nivel 0 (root) o un nivel específico permitido
    if (!parent && hierarchyLevel !== 0) {
      // Permitir ciertos niveles sin padre (ej: roles independientes como CUSTOMER)
      const allowedRootLevels = [0, 4]; // 0=ADMIN, 4=CUSTOMER
      if (!allowedRootLevels.includes(hierarchyLevel)) {
        throw new CustomError({
          message: `Roles with hierarchy level ${hierarchyLevel} require a parent role`,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: GeneralErrorCode.BAD_REQUEST,
          details: `Roles with hierarchy level ${hierarchyLevel} require a parent role`
        });

      }
    }

    // Validar que no haya saltos de jerarquía muy grandes
    if (parent && (hierarchyLevel - parent.hierarchyLevel) > 1) {
      throw new CustomError({
        message: `Hierarchy gap too large. Parent level: ${parent.hierarchyLevel}, Child level: ${hierarchyLevel}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
        details: `Hierarchy gap too large. Parent level: ${parent.hierarchyLevel}, Child level: ${hierarchyLevel}`
      });

    }
  }



  async findAll(input: SearchRolesInput): Promise<PaginatedRolesResponse> {
    try {
      const { filters, pagination, sort } = input;
      const { page = 1, limit = 20 } = pagination;
      const { field = 'createdAt', direction = 'DESC' } = sort;


      const queryBuilder = await this.rolesRepository
        .createQueryBuilder('role')
        .leftJoinAndSelect('role.parent', 'parent')
        .leftJoinAndSelect('role.children', 'children')
        .leftJoinAndSelect('role.permissions', 'permissions')
        .leftJoinAndSelect('role.createdByUser', 'createdByUser')
        .leftJoinAndSelect('role.updatedByUser', 'updatedByUser')
        .leftJoinAndSelect('role.userRoles', 'userRoles')
        .leftJoinAndSelect('userRoles.user', 'user')


      this.applyFilters(queryBuilder, filters);

      queryBuilder.orderBy(`role.${field}`, direction);

      const skip = (page - 1) * limit;
      queryBuilder.skip(skip).take(limit);

      const [items, totalItems] = await queryBuilder.getManyAndCount();

      const totalPages = Math.ceil(totalItems / limit);
      const hasNextPage = page < totalPages;
      const hasPreviousPage = page > 1;

      const meta: PaginationReponse = {
        currentPage: page,
        itemsPerPage: limit,
        totalItems,
        totalPages,
        hasNextPage,
        hasPreviousPage
      };

      return { items, meta };


    } catch (error: any) {
      this.logger.error(`Error al realizar la busqueda por filtros ${error.message}`);

      if (error instanceof CustomError || error instanceof GraphQLError) {
        throw error
      }

      throw new CustomError({
        message: `Error al buscar los pemrisos por filtros: ${error.message}`,
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorCode: GeneralErrorCode.INTERNAL_SERVER_ERROR,
        details: `Error técnico durante la busqueda de permisos: ${error.message}`
      });
    }
  }

  private applyFilters(
    queryBuilder: SelectQueryBuilder<Role>,
    filters: RolesFiltersInput
  ): void {
    const {
      status,
      hierarchyLevel,
      isSystem,
      createdAt,
      search
    } = filters;

    // Filtro por status
    if (typeof status === 'boolean') {
      queryBuilder.andWhere('role.status = :status', { status });
    }

    // Filtro por level
    if (hierarchyLevel !== undefined && hierarchyLevel !== null) {
      queryBuilder.andWhere('role.hierarchyLevel = :hierarchyLevel', {
        hierarchyLevel: hierarchyLevel // GraphQL ya convertirá 0,1,2,3,4 correctamente
      });
    }

    // Filtro por isSystem
    if (typeof isSystem === 'boolean') {
      queryBuilder.andWhere('role.isSystem = :isSystem', { isSystem });
    }

    // Filtro por rango de fechas
    if (createdAt) {
      if (createdAt.from) {
        queryBuilder.andWhere('role.createdAt >= :fromDate', {
          fromDate: new Date(createdAt.from)
        });
      }
      if (createdAt.to) {
        queryBuilder.andWhere('role.createdAt <= :toDate', {
          toDate: new Date(createdAt.to)
        });
      }
    }

    // Búsqueda general por texto
    if (search) {
      queryBuilder.andWhere(
        '(permission.name ILIKE :search OR permission.description ILIKE :search)',
        { search: `%${search}%` }
      );
    }
  }

  async findOne(term: string): Promise<Role> {
    if (!term || typeof term !== 'string') {
      throw new CustomError({
        message: 'Invalid search term provided',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    try {
      let role: Role;

      if (validate(term)) {
        // Buscar por ID (UUID válido)
        role = await this.rolesRepository
          .createQueryBuilder('role')
          .leftJoinAndSelect('role.parent', 'parent')
          .leftJoinAndSelect('role.children', 'children')
          .leftJoinAndSelect('role.permissions', 'permissions')
          .leftJoinAndSelect('role.createdByUser', 'createdByUser')
          .leftJoinAndSelect('role.updatedByUser', 'updatedByUser')
          .leftJoinAndSelect('role.userRoles', 'userRoles')
          .leftJoinAndSelect('userRoles.user', 'user')
          .where('role.id = :id', { id: term })
          .getOne();
      } else {
        // Buscar por nombre (insensible a mayúsculas)
        role = await this.rolesRepository
          .createQueryBuilder('role')
          .leftJoinAndSelect('role.parent', 'parent')
          .leftJoinAndSelect('role.children', 'children')
          .leftJoinAndSelect('role.permissions', 'permissions')
          .leftJoinAndSelect('role.createdByUser', 'createdByUser')
          .leftJoinAndSelect('role.updatedByUser', 'updatedByUser')
          .leftJoinAndSelect('role.userRoles', 'userRoles')
          .leftJoinAndSelect('userRoles.user', 'user')
          .where('LOWER(role.name) = LOWER(:name)', { name: term.trim() })
          .getOne();
      }

      if (!role) {
        const searchBy = validate(term) ? 'id' : 'name';
        this.logger.warn(`Role with ${searchBy} "${term}" not found`);
        throw new CustomError({
          message: `Role with ${searchBy} "${term}" not found`,
          statusCode: HttpStatus.NOT_FOUND,
          errorCode: GeneralErrorCode.NOT_FOUND,
          details: `No role found matching ${searchBy}: ${term}`,
        });
      }

      return role;
    } catch (error: any) {
      this.logger.error(`Error finding role with term "${term}": ${error.message}`);

      if (error instanceof CustomError || error instanceof GraphQLError) {
        throw error;
      }

      throw new CustomError({
        message: 'Error finding role',
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorCode: GeneralErrorCode.INTERNAL_SERVER_ERROR,
        details: `Technical error while finding role with term "${term}": ${error.message}`,
      });
    }
  }


  async findRoleDetail(id: string): Promise<RoleDetailResponse> {
    if (!validate(id)) {
      throw new CustomError({
        message: 'ID de rol inválido',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    const role = await this.rolesRepository
      .createQueryBuilder('role')
      .leftJoinAndSelect('role.parent', 'parent')
      .leftJoinAndSelect('role.children', 'children')
      .leftJoinAndSelect('role.permissions', 'permissions')
      .where('role.id = :id', { id })
      .getOne();

    if (!role) {
      throw new CustomError({
        message: `Rol con id "${id}" no encontrado`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: GeneralErrorCode.NOT_FOUND,
      });
    }

    const permissions = role.permissions ?? [];

    const groupMap = new Map<string, Permission[]>();
    for (const perm of permissions) {
      const list = groupMap.get(perm.group) ?? [];
      list.push(perm);
      groupMap.set(perm.group, list);
    }

    const permissionsByGroup: PermissionGroupSummary[] = Array.from(groupMap.entries()).map(
      ([group, perms]) => ({ group, count: perms.length, permissions: perms }),
    );

    return {
      id: role.id,
      name: role.name,
      frontName: role.frontName,
      icon: role.icon,
      description: role.description,
      hierarchyLevel: role.hierarchyLevel,
      status: role.status,
      isSystem: role.isSystem,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
      parent: role.parent ?? null,
      children: role.children ?? [],
      permissions,
      permissionCount: permissions.length,
      permissionsByGroup,
    };
  }

  async update(id: string, updateRoleInput: UpdateRoleInput): Promise<Role> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Obtener el rol existente con todas sus relaciones
      const existingRole = await queryRunner.manager.findOne(Role, {
        where: { id },
        relations: [
          'parent',
          'children',
          'permissions',
          'createdByUser',
          'updatedByUser',
          'userRoles'
        ]
      });

      if (!existingRole) {
        this.logger.warn(`Intento de actualizar rol inexistente: ${id}`);
        throw new CustomError({
          message: `Role con ID ${id} no encontrado`,
          statusCode: HttpStatus.NOT_FOUND,
          errorCode: RolesErrorCode.ROL_NOT_FOUND,
          details: `No se puede actualizar un rol que no existe: ${id}`
        });
      }

      // 2. Validaciones para roles del sistema
      if (existingRole.isSystem) {
        if (updateRoleInput.name && updateRoleInput.name !== existingRole.name) {
          this.logger.warn(`Intento de modificar nombre de roles del sistema: ${existingRole.name}`);
          throw new CustomError({
            message: `No se puede modificar el nombre de roles del sistema`,
            statusCode: HttpStatus.BAD_REQUEST,
            errorCode: RolesErrorCode.SYSTEM_ROL_CANNOT_BE_MODIFIED,
            details: `El ROL '${existingRole.name}' es un rol del sistema y no se puede renombrar`
          });
        }

        if (updateRoleInput.isSystem === false) {
          this.logger.warn(`Intento de cambiar estado de sistema del rol: ${existingRole.name}`);
          throw new CustomError({
            message: `No se puede cambiar el estado de sistema de un rol crítico`,
            statusCode: HttpStatus.BAD_REQUEST,
            errorCode: RolesErrorCode.SYSTEM_ROL_CANNOT_BE_MODIFIED,
            details: `El rol '${existingRole.name}' debe mantener su estado de sistema`
          });
        }
      }

      // 3. Validar nombre único si se está actualizando
      if (updateRoleInput.name && updateRoleInput.name !== existingRole.name) {
        const duplicateRole = await queryRunner.manager.findOne(Role, {
          where: { name: updateRoleInput.name }
        });

        if (duplicateRole) {
          this.logger.warn(`Intento de actualizar rol con nombre duplicado: ${updateRoleInput.name}`);
          throw new CustomError({
            message: `Ya existe un rol con el nombre: ${updateRoleInput.name}`,
            statusCode: HttpStatus.CONFLICT,
            errorCode: RolesErrorCode.ROL_ALREADY_EXISTS,
            details: `No se puede cambiar el nombre porque ya existe otro rol con ese nombre`
          });
        }
      }

      // 4. Validar permisos si se proporcionaron
      let newPermissions: Permission[] | undefined;
      if (updateRoleInput.permissionIds) {
        newPermissions = await this.validatePermissions(updateRoleInput.permissionIds);
      }

      // 5. Validar jerarquía y rol padre si se están actualizando
      let newParent: Role | null = existingRole.parent;
      const newHierarchyLevel = updateRoleInput.hierarchyLevel ?? existingRole.hierarchyLevel;

      if (updateRoleInput.parentId !== undefined) {
        if (updateRoleInput.parentId === null) {
          newParent = null;
        } else {
          // Validar que el nuevo padre no sea el mismo rol o uno de sus descendientes
          if (updateRoleInput.parentId === id) {
            throw new CustomError({
              message: `Un rol no puede ser padre de sí mismo`,
              statusCode: HttpStatus.BAD_REQUEST,
              errorCode: GeneralErrorCode.BAD_REQUEST,
            });
          }

          // Verificar que no se cree un ciclo en la jerarquía
          const descendants = await this.getDescendantChain(id);
          const descendantIds = descendants.map(d => d.id);

          if (descendantIds.includes(updateRoleInput.parentId)) {
            throw new CustomError({
              message: `No se puede establecer como padre un rol descendiente`,
              statusCode: HttpStatus.BAD_REQUEST,
              errorCode: GeneralErrorCode.BAD_REQUEST,
              details: `El rol ${updateRoleInput.parentId} es descendiente del rol ${id}`
            });
          }

          newParent = await this.validateParentRole(updateRoleInput.parentId, newHierarchyLevel);
        }
      }

      // 6. Validar lógica de jerarquía
      await this.validateHierarchyLogic(newHierarchyLevel, newParent);

      // 7. Validar permisos de herencia inversa si hay cambios en padre o permisos
      if (newParent && newPermissions) {
        await this.validateParentPermissionsForInverseInheritance(newParent, newPermissions);
      }

      // 8. Preparar datos de actualización
      const updateData: Partial<Role> = {
        updatedAt: new Date(),
      };

      // Aplicar solo los campos que se proporcionaron
      if (updateRoleInput.name !== undefined) updateData.name = updateRoleInput.name;
      if (updateRoleInput.description !== undefined) updateData.description = updateRoleInput.description;
      if (updateRoleInput.hierarchyLevel !== undefined) updateData.hierarchyLevel = updateRoleInput.hierarchyLevel;
      if (updateRoleInput.isSystem !== undefined) updateData.isSystem = updateRoleInput.isSystem;
      if (updateRoleInput.metadata !== undefined) updateData.metadata = updateRoleInput.metadata;

      // 9. Actualizar el rol base
      await queryRunner.manager.update(Role, { id }, updateData);

      // 10. Actualizar relación con el padre si cambió
      if (updateRoleInput.parentId !== undefined) {
        const updatedRole = await queryRunner.manager.findOne(Role, {
          where: { id },
          relations: ['parent']
        });

        if (updatedRole) {
          updatedRole.parent = newParent;
          await queryRunner.manager.save(Role, updatedRole);
        }
      }

      // 11. Actualizar permisos si se proporcionaron
      if (newPermissions) {
        const updatedRole = await queryRunner.manager.findOne(Role, {
          where: { id },
          relations: ['permissions']
        });

        if (updatedRole) {
          updatedRole.permissions = newPermissions;
          await queryRunner.manager.save(Role, updatedRole);
        }
      }

      // 12. Obtener el rol completamente actualizado
      const finalRole = await queryRunner.manager.findOne(Role, {
        where: { id },
        relations: [
          'parent',
          'children',
          'permissions',
          'createdByUser',
          'updatedByUser'
        ]
      });

      if (!finalRole) {
        throw new CustomError({
          message: `Error al recuperar el rol actualizado`,
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          errorCode: GeneralErrorCode.INTERNAL_SERVER_ERROR,
        });
      }

      // 13. 🆕 ACTUALIZAR HERENCIA INVERSA si hubo cambios relevantes
      const shouldUpdateInheritance =
        updateRoleInput.permissionIds ||
        updateRoleInput.parentId !== undefined ||
        updateRoleInput.hierarchyLevel !== undefined;

      if (shouldUpdateInheritance) {
        // Actualizar ancestros del rol actual
        if (finalRole.parent) {
          await this.updateParentRolesWithInheritedPermissions(finalRole);
        }

        // Si cambió el padre, también actualizar ancestros del padre anterior
        if (updateRoleInput.parentId !== undefined && existingRole.parent && existingRole.parent.id !== finalRole.parent?.id) {
          await this.updateParentRolesWithInheritedPermissions(existingRole);
        }
      }

      await queryRunner.commitTransaction();

      this.logger.log(`Rol actualizado exitosamente: ${finalRole.id} - ${finalRole.name}`);
      console.log(`✅ Rol actualizado: ${finalRole.name} con herencia inversa aplicada`);

      return finalRole;

    } catch (error: any) {
      await queryRunner.rollbackTransaction();

      this.logger.error(`Error al actualizar rol '${id}': ${error.message}`, error.stack);

      if (error instanceof CustomError || error instanceof GraphQLError) {
        throw error;
      }

      throw new CustomError({
        message: `Error al actualizar el rol: ${error.message}`,
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorCode: GeneralErrorCode.INTERNAL_SERVER_ERROR,
        details: `Error técnico durante la actualización del rol: ${error.message}`
      });

    } finally {
      this.logger.debug(`Recursos de QueryRunner liberados para actualización del rol: ${id}`);
      await queryRunner.release();
    }

  }

  /**
  * Cambia únicamente el padre directo de un rol específico, sin mover necesariamente a sus hijos.
  * 
  * Esta función realiza una reasignación de reporte individual, permitiendo flexibilidad en la
  * reorganización de la estructura jerárquica. A diferencia de moveRoleSubtree, esta operación
  * puede separar un rol de sus descendientes, creando estructuras más dinámicas.
  * 
  * @description
  * Equivale a cambiar a un empleado de departamento sin mover necesariamente a su equipo de trabajo.
  * La operación actualiza la herencia de permisos en ambas ramas (la anterior y la nueva) para
  * mantener la consistencia del sistema.
  * 
  * @param roleId - ID del rol cuyo padre será cambiado
  * @param newParentId - ID del nuevo rol padre, o null para convertirlo en rol raíz
  * @param options - Opciones adicionales para la operación
  * @param options.preserveChildren - Si true, mantiene la relación con los hijos actuales
  * @param options.validateHierarchy - Si true, realiza validaciones adicionales de jerarquía
  * 
  * @returns Promise<ChangeParentResponse> Información detallada sobre el cambio realizado
  * 
  * @throws {ValidationError} Si la asignación del nuevo padre es inválida
  * @throws {NotFoundError} Si el rol o el nuevo padre no existen
  * @throws {HierarchyError} Si la operación violaría las reglas de jerarquía
  * @throws {PermissionError} Si hay conflictos de permisos en la nueva asignación
  * 
  * @example
  * ```typescript
  * // Estructura ANTES:
  * // CEO (nivel 0)
  * // ├── Gerente A (nivel 1)
  * // │   └── Empleado A1 (nivel 2)
  * // └── Gerente B (nivel 1)
  * //     └── Empleado B1 (nivel 2)
  * 
  * const result = await rolesService.changeRoleParent('empleado-b1-id', 'gerente-a-id');
  * 
  * // Estructura DESPUÉS:
  * // CEO (nivel 0)
  * // ├── Gerente A (nivel 1)
  * // │   ├── Empleado A1 (nivel 2)
  * // │   └── Empleado B1 (nivel 2)  ← Solo este rol se movió
  * // └── Gerente B (nivel 1)         ← Queda sin hijos
  * 
  * console.log(result);
  * // {
  * //   roleId: 'empleado-b1-id',
  * //   roleName: 'Empleado B1',
  * //   oldParent: { id: 'gerente-b-id', name: 'Gerente B' },
  * //   newParent: { id: 'gerente-a-id', name: 'Gerente A' },
  * //   affectedRolesCount: 3,
  * //   message: "Rol 'Empleado B1' movido exitosamente. 3 roles actualizados."
  * // }
  * ```
  * 
  * @example
  * ```typescript
  * // Cambiar un rol con opciones específicas
  * const result = await rolesService.changeRoleParent(
  *   'manager-id', 
  *   'new-director-id',
  *   { 
  *     preserveChildren: true,
  *     validateHierarchy: true 
  *   }
  * );
  * ```
  * 
  * @example
  * ```typescript
  * // Promover un rol a la raíz organizacional
  * const result = await rolesService.changeRoleParent('senior-manager-id', null);
  * // El rol se convierte en independiente, reportando directamente al nivel superior
  * ```
  * 
  * @since 1.0.0
  * @see {@link moveRoleSubtree} Para mover un rol junto con toda su descendencia
  * @see {@link validateNewParentAssignment} Para validaciones de compatibilidad de padre
  * @see {@link updateParentRolesWithInheritedPermissions} Para actualización de herencia de permisos
  */
  async changeRoleParent(
    roleId: string,
    newParentId: string | null,
    options?: {
      preserveChildren?: boolean;
      validateHierarchy?: boolean;
    }
  ): Promise<ChangeParentResponse> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const role = await this.getRoleWithFullHierarchy(roleId);
      const oldParent = role.parent;

      // Validaciones específicas para cambio de padre
      if (newParentId) {
        await this.validateNewParentAssignment(role, newParentId);
      }

      // Obtener ancestros que se verán afectados (antes del cambio)
      const oldAncestors = oldParent ? await this.getAncestorChain(oldParent.id) : [];

      // Realizar el cambio de padre
      const newParent = newParentId ? await this.validateParentRole(newParentId, role.hierarchyLevel) : null;
      role.parent = newParent;

      await queryRunner.manager.save(Role, role);

      // Actualizar herencia inversa en ambas ramas
      const affectedRoles = [...oldAncestors];
      if (newParent) {
        const newAncestors = await this.getAncestorChain(newParent.id);
        affectedRoles.push(...newAncestors);
        await this.updateParentRolesWithInheritedPermissions(role);
      }

      // Actualizar ancestros de la rama anterior
      for (const ancestor of oldAncestors) {
        const effectivePermissions = await this.calculateEffectivePermissionsForRole(ancestor.id);
        ancestor.permissions = effectivePermissions;
        await queryRunner.manager.save(Role, ancestor);
      }

      await queryRunner.commitTransaction();

      return {
        roleId: role.id,
        roleName: role.name,
        oldParent: oldParent ? { id: oldParent.id, name: oldParent.name } : null,
        newParent: newParent ? { id: newParent.id, name: newParent.name } : null,
        affectedRolesCount: affectedRoles.length,
        message: `Rol '${role.name}' movido exitosamente. ${affectedRoles.length} roles actualizados.`
      };

    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Mueve un rol completo junto con toda su descendencia a una nueva posición en la jerarquía.
   * 
   * Esta función realiza una operación de movimiento de subárbol completo, manteniendo intacta
   * la estructura interna del subárbol mientras lo reubica bajo un nuevo padre. Todos los
   * descendientes (hijos, nietos, bisnietos, etc.) se mueven junto con el rol objetivo.
   * 
   * @description 
   * Equivale a mover un departamento completo con todos sus subdepartamentos en un organigrama empresarial.
   * La operación recalcula automáticamente los niveles jerárquicos de todo el subárbol y actualiza
   * los permisos por herencia en todas las ramas afectadas.
   * 
   * @param roleId - ID del rol que será movido junto con toda su descendencia
   * @param newParentId - ID del nuevo rol padre, o null para convertirlo en rol raíz
   * 
   * @returns Promise<MoveSubtreeResponse> Información detallada sobre el movimiento realizado
   * 
   * @throws {ValidationError} Si el movimiento crearía un ciclo en la jerarquía
   * @throws {NotFoundError} Si el rol o el nuevo padre no existen
   * @throws {HierarchyError} Si la operación violaría las reglas de jerarquía
   * 
   * @example
   * ```typescript
   * // Estructura ANTES:
   * // CEO (nivel 0)
   * // ├── Gerente A (nivel 1)
   * // │   └── Empleado A1 (nivel 2)
   * // └── Gerente B (nivel 1)
   * //     ├── Subgerente B1 (nivel 2)
   * //     │   └── Empleado B1.1 (nivel 3)
   * //     └── Empleado B2 (nivel 2)
   * 
   * const result = await rolesService.moveRoleSubtree('gerente-b-id', 'gerente-a-id');
   * 
   * // Estructura DESPUÉS:
   * // CEO (nivel 0)
   * // └── Gerente A (nivel 1)
   * //     ├── Empleado A1 (nivel 2)
   * //     └── Gerente B (nivel 2)  ← Movido aquí con todo su subárbol
   * //         ├── Subgerente B1 (nivel 3)  ← Niveles recalculados automáticamente
   * //         │   └── Empleado B1.1 (nivel 4)
   * //         └── Empleado B2 (nivel 3)
   * 
   * console.log(result);
   * // {
   * //   movedRoleId: 'gerente-b-id',
   * //   movedRoleName: 'Gerente B',
   * //   descendantsCount: 3,
   * //   newParent: { id: 'gerente-a-id', name: 'Gerente A' },
   * //   affectedRolesCount: 5,
   * //   message: "Subárbol de 'Gerente B' movido exitosamente."
   * // }
   * ```
   * 
   * @example
   * ```typescript
   * // Mover un rol a la raíz (sin padre)
   * const result = await rolesService.moveRoleSubtree('subgerente-id', null);
   * // El subgerente y todos sus descendientes se convierten en una rama independiente
   * ```
   * 
   * @since 1.0.0
   * @see {@link changeRoleParent} Para mover solo un rol individual sin su descendencia
   * @see {@link validateSubtreeMove} Para validaciones previas al movimiento
   * @see {@link updateSubtreeHierarchyLevels} Para recálculo de niveles jerárquicos
   */
  async moveRoleSubtree(
    roleId: string,
    newParentId: string | null
  ): Promise<MoveSubtreeResponse> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Obtener el rol y toda su descendencia
      const roleWithDescendants = await this.getRoleWithFullDescendants(roleId);

      // Validar que el movimiento sea válido
      await this.validateSubtreeMove(roleWithDescendants, newParentId);

      // Calcular nuevos niveles de jerarquía para todo el subárbol
      const newParent = newParentId ? await this.rolesRepository.findOne({ where: { id: newParentId } }) : null;
      const baseLevel = newParent ? newParent.hierarchyLevel + 1 : 0;

      // Actualizar niveles de jerarquía recursivamente
      await this.updateSubtreeHierarchyLevels(roleWithDescendants, baseLevel, queryRunner);

      // Cambiar el padre del rol raíz
      roleWithDescendants.parent = newParent;
      await queryRunner.manager.save(Role, roleWithDescendants);

      // Actualizar herencia inversa en todas las ramas afectadas
      const affectedCount = await this.updateAllAffectedBranches(roleWithDescendants, queryRunner);

      await queryRunner.commitTransaction();

      return {
        movedRoleId: roleId,
        movedRoleName: roleWithDescendants.name,
        descendantsCount: await this.countDescendants(roleId),
        newParent: newParent ? { id: newParent.id, name: newParent.name } : null,
        affectedRolesCount: affectedCount,
        message: `Subárbol de '${roleWithDescendants.name}' movido exitosamente.`
      };

    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // 🔗 Asignar múltiples hijos a un padre
  async assignMultipleChildren(
    parentId: string,
    childrenIds: string[]
  ): Promise<AssignChildrenResponse> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const parent = await this.rolesRepository.findOne({ where: { id: parentId } });
      if (!parent) {
        throw new CustomError({
          message: `Parent role not found`,
          statusCode: HttpStatus.NOT_FOUND,
          errorCode: RolesErrorCode.ROL_NOT_FOUND
        });
      }

      const results = [];
      const affectedAncestors = new Set<string>();

      for (const childId of childrenIds) {
        const child = await this.rolesRepository.findOne({
          where: { id: childId },
          relations: ['parent']
        });

        if (!child) {
          this.logger.warn(`Child role not found: ${childId}`);
          continue;
        }

        // Validar que el hijo pueda ser asignado a este padre
        await this.validateParentChildAssignment(parent, child);

        // Guardar padre anterior para limpiar herencia
        const oldParent = child.parent;

        // Asignar nuevo padre
        child.parent = parent;
        child.hierarchyLevel = parent.hierarchyLevel + 1;

        await queryRunner.manager.save(Role, child);

        // Marcar ancestros afectados
        if (oldParent) {
          const oldAncestors = await this.getAncestorChain(oldParent.id);
          oldAncestors.forEach(a => affectedAncestors.add(a.id));
        }

        const newAncestors = await this.getAncestorChain(parent.id);
        newAncestors.forEach(a => affectedAncestors.add(a.id));

        results.push({
          childId: child.id,
          childName: child.name,
          success: true
        });
      }

      // Actualizar herencia inversa en todos los ancestros afectados
      for (const ancestorId of affectedAncestors) {
        const effectivePermissions = await this.calculateEffectivePermissionsForRole(ancestorId);
        await queryRunner.manager.update(Role, { id: ancestorId }, { permissions: effectivePermissions });
      }

      await queryRunner.commitTransaction();

      return {
        parentId: parent.id,
        parentName: parent.name,
        assignedChildren: results,
        affectedAncestorsCount: affectedAncestors.size,
        message: `${results.length} hijos asignados a '${parent.name}'. ${affectedAncestors.size} ancestros actualizados.`
      };

    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // 🔍 Obtener jerarquía completa de un rol
  async getRoleHierarchy(roleId: string): Promise<RoleHierarchyResponse> {
    const role = await this.rolesRepository.findOne({
      where: { id: roleId },
      relations: ['parent', 'children', 'permissions']
    });

    if (!role) {
      throw new CustomError({
        message: `Role not found`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: RolesErrorCode.ROL_NOT_FOUND
      });
    }

    // Obtener ancestros
    const ancestors = role.parent ? await this.getAncestorChain(role.parent.id) : [];

    // Obtener descendientes
    const descendants = await this.getDescendantChain(roleId);

    // Calcular permisos efectivos
    const effectivePermissions = await this.calculateEffectivePermissionsForRole(roleId);

    return {
      role: {
        id: role.id,
        name: role.name,
        description: role.description,
        hierarchyLevel: role.hierarchyLevel,
        status: role.status,
        isSystem: role.isSystem
      },
      ancestors: ancestors.map(a => ({
        id: a.id,
        name: a.name,
        hierarchyLevel: a.hierarchyLevel,
        distance: role.hierarchyLevel - a.hierarchyLevel
      })),
      descendants: descendants.map(d => ({
        id: d.id,
        name: d.name,
        hierarchyLevel: d.hierarchyLevel,
        distance: d.hierarchyLevel - role.hierarchyLevel
      })),
      directPermissions: role.permissions?.map(p => ({
        id: p.id,
        name: p.name,
        source: 'DIRECT'
      })) || [],
      effectivePermissions: effectivePermissions.map(p => ({
        id: p.id,
        name: p.name,
        source: this.getPermissionSource(p, role.permissions || [])
      })),
      stats: {
        ancestorCount: ancestors.length,
        descendantCount: descendants.length,
        directPermissionCount: role.permissions?.length || 0,
        effectivePermissionCount: effectivePermissions.length
      }
    };
  }

  async findPermissionsForRoles(roleIds: string[]): Promise<Permission[]> {
    return this.permissionsRepository
      .createQueryBuilder('permission')
      .innerJoin('permission.roles', 'role')
      .where('role.id IN (:...roleIds)', { roleIds })
      .getMany();
  }

  private getPermissionSource(permission: Permission, directPermissions: Permission[]): string {
    return directPermissions.some(dp => dp.id === permission.id) ? 'DIRECT' : 'INHERITED';
  }

  // Método auxiliar para obtener la cadena de descendientes
  private async getDescendantChain(roleId: string): Promise<Role[]> {
    const descendants: Role[] = [];
    const visited = new Set<string>();

    const collectDescendants = async (currentRoleId: string) => {
      if (visited.has(currentRoleId)) return;
      visited.add(currentRoleId);

      const children = await this.rolesRepository.find({
        where: { parent: { id: currentRoleId } },
        relations: ['parent']
      });

      for (const child of children) {
        descendants.push(child);
        await collectDescendants(child.id);
      }
    };

    await collectDescendants(roleId);
    return descendants;
  }

  async remove(id: string): Promise<RemoveRoleResponse> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Verificar si el rol existe
      const existingRole = await queryRunner.manager.findOne(Role, {
        where: { id },
        relations: [
          'parent',
          'children',
          'permissions',
          'UserRoles',
          'UserRoles.user'
        ]
      });

      if (!existingRole) {
        this.logger.warn(`Intento de eliminar rol inexistente: ${id}`);
        throw new CustomError({
          message: `Rol con ID ${id} no encontrado`,
          statusCode: HttpStatus.NOT_FOUND,
          errorCode: RolesErrorCode.ROL_NOT_FOUND,
          details: `No se puede eliminar un rol que no existe: ${id}`
        });
      }

      // 2. Verificar si ya está eliminado (soft delete)
      if (!existingRole.status) {
        this.logger.warn(`Intento de eliminar rol ya eliminado: ${existingRole.name} (${id})`);
        throw new CustomError({
          message: `El rol '${existingRole.name}' ya está eliminado`,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: RolesErrorCode.ROL_ALREADY_DELETED,
          details: `El rol ya se encuentra en estado eliminado (status: false)`
        });
      }

      // 3. Verificar si es un rol del sistema crítico
      if (existingRole.isSystem) {
        this.logger.warn(`Intento de eliminar rol crítico del sistema: ${existingRole.name}`);
        throw new CustomError({
          message: `No se puede eliminar roles críticos del sistema`,
          statusCode: HttpStatus.FORBIDDEN,
          errorCode: RolesErrorCode.SYSTEM_ROL_CANNOT_BE_MODIFIED,
          details: `El rol '${existingRole.name}' es crítico para el funcionamiento del sistema y no puede ser eliminado`
        });
      }

      // 4. Verificar si tiene roles hijos activos (impacto jerárquico)
      const activeChildren = existingRole.children?.filter(child => child.status) || [];
      if (activeChildren.length > 0) {
        const childrenNames = activeChildren.map(child => child.name).join(', ');
        this.logger.warn(
          `Intento de eliminar rol con hijos activos: ${existingRole.name}. Hijos: ${childrenNames}`
        );

        throw new CustomError({
          message: `No se puede eliminar el rol porque tiene roles hijos activos`,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: RolesErrorCode.ROL_HAS_ACTIVE_CHILDREN,
          details: `Los siguientes roles hijos están activos: ${childrenNames}. Elimine o reasigne estos roles primero.`
        });
      }

      // 5. Verificar si hay usuarios activos asignados a este rol
      const activeUserAssignments = existingRole.userRoles?.filter(
        UserRole => UserRole.user.status && UserRole.role.status
      ) || [];

      if (activeUserAssignments.length > 0) {
        const userNames = activeUserAssignments.map(ur => ur.user.name || ur.user.email).join(', ');
        this.logger.warn(
          `Intento de eliminar rol con usuarios activos: ${existingRole.name}. ` +
          `Usuarios: ${activeUserAssignments.length}`
        );

        throw new CustomError({
          message: `No se puede eliminar el rol porque tiene usuarios activos asignados`,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: RolesErrorCode.ROL_HAS_ACTIVE_USERS,
          details: `El rol '${existingRole.name}' está asignado a ${activeUserAssignments.length} usuarios activos: ${userNames}. Revoque estas asignaciones antes de eliminar el rol.`
        });
      }

      // 6. 🆕 IMPACTO EN HERENCIA INVERSA: Obtener roles padre que se verán afectados
      const affectedAncestors: Role[] = [];
      if (existingRole.parent) {
        const ancestors = await this.getAncestorChain(existingRole.parent.id);
        affectedAncestors.push(...ancestors);
      }

      this.logger.log(`Eliminando rol (soft delete): ${existingRole.name} (ID: ${id})`);

      // 7. Realizar soft delete cambiando status a false
      const updateData: Partial<Role> = {
        status: false,
        updatedAt: new Date(),
        // Opcional: agregar metadata sobre la eliminación
        metadata: {
          ...existingRole.metadata,
          deletedAt: new Date().toISOString(),
          deletedReason: 'SOFT_DELETE_BY_ADMIN',
          previousParentId: existingRole.parent?.id || null,
          affectedAncestorIds: affectedAncestors.map(a => a.id)
        }
      };

      await queryRunner.manager.update(Role, { id }, updateData);

      // 8. 🆕 ACTUALIZAR HERENCIA INVERSA: Recalcular permisos de ancestros
      for (const ancestor of affectedAncestors) {
        const effectivePermissions = await this.calculateEffectivePermissionsForRole(ancestor.id);
        ancestor.permissions = effectivePermissions;
        await queryRunner.manager.save(Role, ancestor);

        console.log(`🔄 Actualizado rol ancestro tras eliminación: ${ancestor.name} con ${effectivePermissions.length} permisos`);
      }

      // 9. Obtener el rol actualizado
      const deletedRole = await queryRunner.manager.findOne(Role, {
        where: { id },
        relations: ['parent', 'permissions']
      });

      await queryRunner.commitTransaction();

      this.logger.log(`Rol eliminado exitosamente (soft delete): ${deletedRole.id} - ${deletedRole.name}`);
      console.log(`❌ Rol eliminado: ${deletedRole.name} con herencia inversa actualizada`);

      // 10. Mapear respuesta
      const response: RemoveRoleResponse = {
        id: deletedRole.id,
        name: deletedRole.name,
        description: deletedRole.description,
        status: deletedRole.status,
        hierarchyLevel: deletedRole.hierarchyLevel,
        isSystem: deletedRole.isSystem,
        metadata: deletedRole.metadata,
        parent: deletedRole.parent ? {
          id: deletedRole.parent.id,
          name: deletedRole.parent.name,
          description: deletedRole.parent.description
        } : null,
        permissions: deletedRole.permissions?.map(perm => ({
          id: perm.id,
          name: perm.name,
          description: perm.description
        })) || [],
        deletedAt: deletedRole.updatedAt,
        createdAt: deletedRole.createdAt,
        affectedAncestorsCount: affectedAncestors.length,
        message: `Rol '${deletedRole.name}' eliminado correctamente. ${affectedAncestors.length} roles ancestros actualizados.`
      };

      return response;

    } catch (error: any) {
      await queryRunner.rollbackTransaction();

      if (error instanceof CustomError || error instanceof GraphQLError) {
        throw error;
      }

      this.logger.error(`Error al eliminar rol '${id}': ${error.message}`, error.stack);

      throw new CustomError({
        message: `Error al eliminar el rol: ${error.message}`,
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorCode: GeneralErrorCode.INTERNAL_SERVER_ERROR,
        details: `Error técnico durante la eliminación del rol: ${error.message}`
      });

    } finally {
      await queryRunner.release();
      this.logger.debug(`Recursos de QueryRunner liberados para eliminación del rol: ${id}`);
    }
  }

  async restore(id: string): Promise<RestoreRoleResponse> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Verificar si el rol existe
      const existingRole = await queryRunner.manager.findOne(Role, {
        where: { id },
        relations: ['parent', 'permissions']
      });

      if (!existingRole) {
        throw new CustomError({
          message: `Rol con ID ${id} no encontrado`,
          statusCode: HttpStatus.NOT_FOUND,
          errorCode: RolesErrorCode.ROL_NOT_FOUND
        });
      }

      // 2. Verificar si ya está activo
      if (existingRole.status) {
        throw new CustomError({
          message: `El rol '${existingRole.name}' ya está activo`,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: RolesErrorCode.ROL_IS_ACTIVE,
          details: `El rol no necesita ser restaurado porque ya está activo`
        });
      }

      // 3. Validar que el rol padre (si existe) esté activo
      if (existingRole.parent && !existingRole.parent.status) {
        throw new CustomError({
          message: `No se puede restaurar el rol porque su rol padre está inactivo`,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: RolesErrorCode.PARENT_ROL_INACTIVE,
          details: `El rol padre '${existingRole.parent.name}' debe estar activo antes de restaurar este rol`
        });
      }

      // 4. Validar que todos los permisos asignados estén activos
      const inactivePermissions = existingRole.permissions?.filter(perm => !perm.status) || [];
      if (inactivePermissions.length > 0) {
        const inactiveNames = inactivePermissions.map(p => p.name).join(', ');
        this.logger.warn(
          `Intento de restaurar rol con permisos inactivos: ${existingRole.name}. ` +
          `Permisos inactivos: ${inactiveNames}`
        );

        throw new CustomError({
          message: `No se puede restaurar el rol porque tiene permisos inactivos asignados`,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: RolesErrorCode.ROL_HAS_INACTIVE_PERMISSIONS,
          details: `Los siguientes permisos están inactivos: ${inactiveNames}. Active estos permisos primero o revíselos antes de restaurar el rol.`
        });
      }

      // 5. 🆕 PREPARAR HERENCIA INVERSA: Obtener ancestros que se verán afectados
      const affectedAncestors: Role[] = [];
      if (existingRole.parent) {
        const ancestors = await this.getAncestorChain(existingRole.parent.id);
        affectedAncestors.push(...ancestors);
      }

      this.logger.log(`Restaurando rol: ${existingRole.name} (ID: ${id})`);

      // 6. Restaurar el rol
      const updateData: Partial<Role> = {
        status: true,
        updatedAt: new Date(),
        metadata: {
          ...existingRole.metadata,
          restoredAt: new Date().toISOString(),
          restoredReason: 'RESTORED_BY_ADMIN',
          affectedAncestorIds: affectedAncestors.map(a => a.id)
        }
      };

      await queryRunner.manager.update(Role, { id }, updateData);

      // 7. 🆕 ACTUALIZAR HERENCIA INVERSA: Recalcular permisos de ancestros
      const restoredRole = await queryRunner.manager.findOne(Role, {
        where: { id },
        relations: ['parent', 'permissions']
      });

      // Aplicar herencia inversa si el rol restaurado tiene padre
      if (restoredRole.parent) {
        await this.updateParentRolesWithInheritedPermissions(restoredRole);
      }

      await queryRunner.commitTransaction();

      this.logger.log(`Rol restaurado exitosamente: ${restoredRole.id} - ${restoredRole.name}`);
      console.log(`✅ Rol restaurado: ${restoredRole.name} con herencia inversa aplicada`);

      // 8. Mapear respuesta
      const response: RestoreRoleResponse = {
        id: restoredRole.id,
        name: restoredRole.name,
        description: restoredRole.description,
        status: restoredRole.status,
        hierarchyLevel: restoredRole.hierarchyLevel,
        isSystem: restoredRole.isSystem,
        metadata: restoredRole.metadata,
        parent: restoredRole.parent ? {
          id: restoredRole.parent.id,
          name: restoredRole.parent.name,
          description: restoredRole.parent.description,
          hierarchyLevel: restoredRole.parent.hierarchyLevel,
          isSystem: restoredRole.parent.isSystem,
          status: restoredRole.parent.status
        } : null,
        permissions: restoredRole.permissions?.map(perm => ({
          id: perm.id,
          name: perm.name,
          description: perm.description,
          // level: perm.level,
          group: perm.group,

        })) || [],
        restoredAt: restoredRole.updatedAt,
        createdAt: restoredRole.createdAt,
        affectedAncestorsCount: affectedAncestors.length,
        message: `Rol '${restoredRole.name}' restaurado correctamente. ${affectedAncestors.length} roles ancestros actualizados.`
      };

      return response;

    } catch (error: any) {
      await queryRunner.rollbackTransaction();

      if (error instanceof CustomError || error instanceof GraphQLError) {
        throw error;
      }

      this.logger.error(`Error al restaurar rol '${id}': ${error.message}`, error.stack);

      throw new CustomError({
        message: `Error al restaurar el rol: ${error.message}`,
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorCode: GeneralErrorCode.INTERNAL_SERVER_ERROR,
        details: `Error técnico durante la restauración del rol: ${error.message}`
      });

    } finally {
      await queryRunner.release();
      this.logger.debug(`Recursos de QueryRunner liberados para restauración del rol: ${id}`);
    }
  }

  //**************************************************************************************************************************
  //**************************************************************************************************************************
  //***********************************************************🔧 METODOS AUXILIARES 🔧**************************************
  //**************************************************************************************************************************
  //**************************************************************************************************************************

  private async getRoleWithFullHierarchy(roleId: string): Promise<Role> {
    const role = await this.rolesRepository.findOne({
      where: { id: roleId },
      relations: [
        'parent',
        'children',
        'permissions',
        'userRoles',
        'userRoles.user'
      ]
    });

    if (!role) {
      throw new CustomError({
        message: `Role not found`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: RolesErrorCode.ROL_NOT_FOUND
      });
    }

    return role;
  }

  private async validateNewParentAssignment(role: Role, newParentId: string): Promise<void> {
    // Validar que no se cree un ciclo
    const descendants = await this.getDescendantChain(role.id);
    const descendantIds = descendants.map(d => d.id);

    if (descendantIds.includes(newParentId)) {
      throw new CustomError({
        message: `Cannot assign descendant as parent`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
        details: `The role ${newParentId} is a descendant of ${role.id}`
      });
    }

    // Validar que el rol no se asigne a sí mismo
    if (role.id === newParentId) {
      throw new CustomError({
        message: `Role cannot be parent of itself`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST
      });
    }

    // Validar que el nuevo padre exista y esté activo
    const newParent = await this.rolesRepository.findOne({
      where: { id: newParentId, status: true }
    });

    if (!newParent) {
      throw new CustomError({
        message: `New parent role not found or inactive`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: RolesErrorCode.ROL_NOT_FOUND
      });
    }

    // Validar jerarquía
    if (newParent.hierarchyLevel >= role.hierarchyLevel) {
      throw new CustomError({
        message: `Parent hierarchy level must be lower than child level`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
        details: `Parent level: ${newParent.hierarchyLevel}, Child level: ${role.hierarchyLevel}`
      });
    }
  }

  private async getRoleWithFullDescendants(roleId: string): Promise<Role> {
    return await this.getRoleWithFullHierarchy(roleId);
  }

  private async validateSubtreeMove(role: Role, newParentId: string | null): Promise<void> {
    if (!newParentId) return; // Moving to root is always valid

    await this.validateNewParentAssignment(role, newParentId);
  }

  private async updateSubtreeHierarchyLevels(
    role: Role,
    baseLevel: number,
    queryRunner: QueryRunner
  ): Promise<void> {
    // Actualizar nivel del rol actual
    await queryRunner.manager.update(Role, { id: role.id }, { hierarchyLevel: baseLevel });

    // Obtener y actualizar hijos recursivamente
    const children = await queryRunner.manager.find(Role, {
      where: { parent: { id: role.id } }
    });

    for (const child of children) {
      await this.updateSubtreeHierarchyLevels(child, baseLevel + 1, queryRunner);
    }
  }

  private async updateAllAffectedBranches(role: Role, queryRunner: QueryRunner): Promise<number> {
    let affectedCount = 0;

    // Actualizar rama actual (hacia arriba)
    if (role.parent) {
      const ancestors = await this.getAncestorChain(role.parent.id);
      for (const ancestor of ancestors) {
        const effectivePermissions = await this.calculateEffectivePermissionsForRole(ancestor.id);
        ancestor.permissions = effectivePermissions;
        await queryRunner.manager.save(Role, ancestor);
        affectedCount++;
      }
    }

    return affectedCount;
  }

  private async countDescendants(roleId: string): Promise<number> {
    const descendants = await this.getDescendantChain(roleId);
    return descendants.length;
  }

  private async validateParentChildAssignment(parent: Role, child: Role): Promise<void> {
    // Reutilizar la validación existente
    await this.validateNewParentAssignment(child, parent.id);
  }


  createVirtualUserRole(userId: string): UserRole {
    const userRole = new UserRole();
    userRole.id = uuid();
    userRole.isPrimary = true;
    userRole.assignedAt = new Date();
    // userRole.user.id = userId;

    // userRole.role.id = this.defaultUserRole.id;
    userRole.role = this.defaultUserRole;

    return userRole;
  }

  // Asignar Rol a Usuario
  async assignRoleToUser(
    assignedBy: string,
    userId: string,
    roleName: ValidRoles,
  ): Promise<AssignedUserRolResponse> {
    const queryRunner = this.dataSource.createQueryRunner()
    queryRunner.connect();
    queryRunner.startTransaction()

    try {
      // 1) Buscar el rol por nombre y estado activo
      const role = await queryRunner.manager.findOne(Role, {
        where: { name: roleName, status: true },
      });

      if (!role) {
        this.logger.warn(`⚠️ Rol no encontrado: ${roleName}`);
        throw new CustomError({
          message: `Rol "${roleName}" no encontrado en el sistema`,
          statusCode: HttpStatus.NOT_FOUND,
          errorCode: GeneralErrorCode.NOT_FOUND,
        });
      }

      // 2) Verificar si el usuario ya tiene algún rol asignado
      const existingUserRole = await queryRunner.manager.findOne(UserRole, {
        where: { user: { id: userId } },
        relations: ['role'], // Asegura que `role` esté cargado si existe
      });

      if (existingUserRole) {
        // Si ya tiene el mismo rol → no hacer nada
        if (existingUserRole.role?.id === role.id) {
          this.logger.log(`ℹ️ Usuario ya tiene asignado el rol: ${roleName}`);
          return;
        }

        // Si tiene un rol diferente → no permitir asignación (solo un rol permitido)
        this.logger.warn(`⚠️ El usuario ${userId} ya tiene otro rol asignado: ${existingUserRole.role?.name || existingUserRole.role.id}`);

        throw new CustomError({
          message: 'El usuario ya tiene un rol asignado y no puede tener más de uno',
          statusCode: HttpStatus.CONFLICT,
          errorCode: GeneralErrorCode.CONFLICT,
        });
      }

      // 3) Crear y guardar la nueva asignación de rol
      const userRole = queryRunner.manager.create(UserRole, {
        user: { id: userId },
        role: { id: role.id },
        assignedAt: new Date(),
        assigned_by: assignedBy,
      });

      await queryRunner.manager.save(userRole);

      await queryRunner.commitTransaction();


      this.logger.log(`✅ Rol "${roleName}" asignado al usuario: ${userId}`);

      return {
        success: true,
        message: `✅ Rol "${roleName}" asignado al usuario: ${userId}`
      }
    } catch (error) {
      // Registrar el error y relanzarlo (útil si estás en una transacción externa)
      this.logger.error(`❌ Error al asignar rol "${roleName}" al usuario ${userId}:`, error);
      throw error; // Re-lanzar para que lo maneje el llamador (ej. rollback en transacción)
    } finally {
      await queryRunner.release();
    }
  }


  //  Verificar si Usuario tiene Rol
  async userHasRole(
    userId: string,
    roleName: string,
  ): Promise<boolean> {

    const queryRunner = await this.dataSource.createQueryRunner();
    queryRunner.connect()
    queryRunner.startTransaction()
    try {

      const count = await queryRunner.manager
        .createQueryBuilder(UserRole, 'UserRole')
        .innerJoin('UserRole.role', 'role')
        .where('UserRole.user.id = :userId', { userId })
        .andWhere('role.name = :roleName', { roleName })
        .getCount();

      await queryRunner.commitTransaction();

      return count > 0;

    } catch (error) {
      this.logger.error(`❌ Error al asignar rol "${roleName}" al usuario ${userId}:`, error);
      throw error; // Re-lanzar para que lo maneje el llamador (ej. rollback en transacción)
    } finally {
      await queryRunner.release();
    }
  }

  // Remover Rol de Usuario
  async removeRoleFromUser(
    userId: string,
    roleName: string,
    queryRunner: any,
  ): Promise<void> {
    // Buscar el rol
    const role = await queryRunner.manager.findOne(Role, {
      where: { name: roleName },
    });

    if (!role) {
      this.logger.warn(`⚠️ Rol no encontrado: ${roleName}`);
      return;
    }

    // Buscar la relación UserRole
    const userRole = await queryRunner.manager.findOne(UserRole, {
      where: {
        user: {
          id: userId
        },
        role: {
          id: role.id
        },
      },
    });

    if (!userRole) {
      this.logger.log(`ℹ️ Usuario no tiene el rol: ${roleName}`);
      return;
    }

    // Eliminar la relación
    await queryRunner.manager.remove(UserRole, userRole);

    this.logger.log(`🗑️ Rol "${roleName}" removido de usuario: ${userId}`);
  }


}

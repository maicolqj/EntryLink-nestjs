import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { CreatePermissionInput } from '../dto/inputs/create-permission.input';
import { UpdatePermissionInput } from '../dto/inputs/update-permission.input';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, In, SelectQueryBuilder } from 'typeorm';
import { Permission } from '../entities/permission.entity';
import { PermissionDependencyService } from './permission-dependecy.service';
import { CreatePermissionResponse } from '../dto/responses/create-permission-response';
import { CustomError } from '../../shared/utils/errors.utils';
import { GeneralErrorCode, PermissionErrorCode } from '../../shared/constans/error-codes.constants';
import { GraphQLError } from 'graphql/error';
import { SearchPermissionsInput } from '../dto/inputs/search-permission.input';
import { PaginatedPermissionsResponse } from '../dto/responses/paginate-permissions.response';
import { PaginationReponse } from '../../shared/dto/responses/pagination-object.response';
import { PermissionFiltersInput } from '../dto/inputs/permission-filter.input';
import { UpdatePermissionResponse } from '../dto/responses/updated-permission-response';
import { RemovePermissionResponse } from '../dto/responses/remove-permission.response';
import { RestorePermissionResponse } from '../dto/responses/restore-permission.response';

@Injectable()
export class PermissionsService {
  private readonly logger: Logger = new Logger(PermissionsService.name);

  constructor(
    @InjectRepository(Permission)
    private readonly permissionsRepository: Repository<Permission>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly dependencyService: PermissionDependencyService,
  ) { }

  async create(createPermissionInput: CreatePermissionInput): Promise<CreatePermissionResponse> {

    this.logger.verbose(`**********************************`)
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const existingPermission = await this.permissionsRepository.findOne({
        where: { name: createPermissionInput.name },
      });

      if (existingPermission) {
        // this.logger.warn(`Intento de crear permiso duplicado: ${createPermissionInput.name}`);
        throw new CustomError({
          message: `Intento de crear permiso duplicado: ${createPermissionInput.name}`,
          statusCode: HttpStatus.CONFLICT,
          errorCode: PermissionErrorCode.PERMISSION_ALREADY_EXISTS
        });
      }

      let dependentPermissions: Permission[] = [];

      if (createPermissionInput.dependsOn && createPermissionInput.dependsOn.length > 0) {
        this.logger.debug(
          `Validando dependencias para permiso '${createPermissionInput.name}': ${createPermissionInput.dependsOn.join(', ')}`
        );

        dependentPermissions = await queryRunner.manager.find(Permission, {
          where: { id: In(createPermissionInput.dependsOn) }
        });

        if (dependentPermissions.length !== createPermissionInput.dependsOn.length) {
          const foundIds = dependentPermissions.map(p => p.id);
          const missingIds = createPermissionInput.dependsOn.filter(missPer => !foundIds.includes(missPer.id));

          throw new CustomError({
            message: `Los siguientes permisos de dependencia no existen: ${missingIds.join(', ')}`,
            statusCode: HttpStatus.BAD_REQUEST,
            errorCode: PermissionErrorCode.PERMISSION_NOT_EXISTS,
            details: `Permisos no encontrados: ${missingIds.join(', ')}`
          });
        }

        const tempId = 'temp-validation-id';
        try {
          await this.dependencyService.validateCircularDependency(
            tempId,
            createPermissionInput.dependsOn.map(dep => dep.id)
          );
        } catch (error: any) {
          throw new CustomError({
            message: `No se puede crear el permiso debido a dependencia circular: ${error.message}`,
            statusCode: HttpStatus.BAD_REQUEST,
            errorCode: PermissionErrorCode.PERMISSION_NOT_EXISTS,
            details: `No se puede crear el permiso debido a dependencia circular: ${error.message}`
          });
        }
      }

      this.logger.log(`Creando nuevo permiso: ${createPermissionInput.name}`);

      const newPermission = queryRunner.manager.create(Permission, {
        name: createPermissionInput.name,
        description: createPermissionInput.description,
        level: createPermissionInput.level,
        label: createPermissionInput.label,
        isSystem: createPermissionInput.isSystem,
        group: createPermissionInput.group,
        // metadata: createPermissionInput.metadata,
        category: createPermissionInput.group,
        dependsOn: dependentPermissions,
      });

      const savedPermission = await queryRunner.manager.save(Permission, newPermission);

      await queryRunner.commitTransaction();

      this.logger.log(`Permiso creado exitosamente: ${savedPermission.id} - ${savedPermission.name}`);

      const response: CreatePermissionResponse = {
        id: savedPermission.id,
        name: savedPermission.name,
        description: savedPermission.description,
        status: savedPermission.status,
        level: savedPermission.level,
        isSystem: savedPermission.isSystem,
        // metadata: savedPermission.metadata,
        category: savedPermission.group,
        dependsOn: savedPermission.dependsOn.map(dep => ({
          id: dep.id,
          name: dep.name,
          description: dep.description
        })),
        createdAt: savedPermission.createdAt,
      };
      return response;

    } catch (error: any) {
      await queryRunner.rollbackTransaction();

      if (error instanceof CustomError || error instanceof GraphQLError) {
        throw error;
      }

      throw new CustomError({
        message: `Error al crear el permiso: ${error.message}`,
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorCode: GeneralErrorCode.INTERNAL_SERVER_ERROR,
        details: `Error técnico durante la creación del permiso: ${error.message}`
      });

    } finally {
      await queryRunner.release();
      this.logger.debug(`Recursos de QueryRunner liberados para permiso: ${createPermissionInput.name}`);
    }
  }



async findAll(input: SearchPermissionsInput): Promise<PaginatedPermissionsResponse> {
    try {
      const { filters, pagination, sort } = input;
      const { page = 1, limit = 20 } = pagination;
      const { field = 'createdAt', direction = 'DESC' } = sort;

      const queryBuilder = await this.permissionsRepository
        .createQueryBuilder('permission')
        .leftJoinAndSelect('permission.dependsOn', 'dependsOn')
        .leftJoinAndSelect('permission.dependentPermissions', 'dependentPermissions');


      this.applyFilters(queryBuilder, filters);

      queryBuilder.orderBy(`permission.${field}`, direction);

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
    queryBuilder: SelectQueryBuilder<Permission>,
    filters: PermissionFiltersInput
  ): void {
    const {
      status,
      level,
      isSystem,
      category,
      hasDependentPermissions,
      createdAt,
      search
    } = filters;

    // Filtro por status
    if (typeof status === 'boolean') {
      queryBuilder.andWhere('permission.status = :status', { status });
    }

    // Filtro por level
    if (level) {
      queryBuilder.andWhere('permission.level = :level', { level });
    }

    // Filtro por isSystem
    if (typeof isSystem === 'boolean') {
      queryBuilder.andWhere('permission.isSystem = :isSystem', { isSystem });
    }

    // Filtro por category
    if (category) {
      queryBuilder.andWhere('permission.category = :category', { category });
    }

    // Filtro por dependentPermissions
    if (typeof hasDependentPermissions === 'boolean') {
      if (!hasDependentPermissions) {
        queryBuilder.andWhere('EXISTS (SELECT 1 FROM permission_dependencies pd WHERE pd.depends_on_permission_id = permission.id)');
      } else {
        queryBuilder.andWhere('NOT EXISTS (SELECT 1 FROM permission_dependencies pd WHERE pd.depends_on_permission_id = permission.id)');
      }
    }

    // Filtro por rango de fechas
    if (createdAt) {
      if (createdAt.from) {
        queryBuilder.andWhere('permission.createdAt >= :fromDate', {
          fromDate: new Date(createdAt.from)
        });
      }
      if (createdAt.to) {
        queryBuilder.andWhere('permission.createdAt <= :toDate', {
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

  async findOne(id: string) {
    try {
      const permission = await this.permissionsRepository.findOne({
        where: { id },
        relations: ['dependsOn', 'dependentPermissions']
      });
      if (!permission) {
        this.logger.warn(`Permission with id ${id} not found`);
        throw new CustomError({
          message: `Permission with id ${id} not found`,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: GeneralErrorCode.BAD_REQUEST,
          details: `Error technical while finding permission with id ${id}`
        })
      }

      return permission;
    } catch (error: any) {
      this.logger.error(`Error finding permission with id ${id} : ${error.message}`)
      if (error instanceof CustomError || error instanceof GraphQLError) {
        throw error;
      }

      throw new CustomError({
        message: `Error finding permission with id ${id} : ${error.message}`,
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorCode: GeneralErrorCode.INTERNAL_SERVER_ERROR,
        details: `Error technical while finding permission with id ${id} : ${error.message}`
      })
    }
  }

  async update(id: string, updatePermissionInput: UpdatePermissionInput): Promise<UpdatePermissionResponse> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {

      const existingPermission = await queryRunner.manager.findOne(Permission, {
        where: { id },
        relations: ['dependsOn']
      });

      if (!existingPermission) {
        this.logger.warn(`Intento de actualizar permiso inexistente: ${id}`);
        throw new CustomError({
          message: `Permiso con ID ${id} no encontrado`,
          statusCode: HttpStatus.NOT_FOUND,
          errorCode: PermissionErrorCode.PERMISSION_NOT_EXISTS,
          details: `No se puede actualizar un permiso que no existe: ${id}`
        });
      }

      if (existingPermission.isSystem) {
        if (updatePermissionInput.name && updatePermissionInput.name !== existingPermission.name) {
          this.logger.warn(`Intento de modificar nombre de permiso del sistema: ${existingPermission.name}`);
          throw new CustomError({
            message: `No se puede modificar el nombre de permisos del sistema`,
            statusCode: HttpStatus.BAD_REQUEST,
            errorCode: PermissionErrorCode.SYSTEM_PERMISSION_MODIFICATION_NOT_ALLOWED,
            details: `El permiso '${existingPermission.name}' es un permiso del sistema y no se puede renombrar`
          });
        }

        if (updatePermissionInput.isSystem === false) {
          this.logger.warn(`Intento de cambiar estado de sistema del permiso: ${existingPermission.name}`);
          throw new CustomError({
            message: `No se puede cambiar el estado de sistema de un permiso crítico`,
            statusCode: HttpStatus.BAD_REQUEST,
            errorCode: PermissionErrorCode.SYSTEM_PERMISSION_MODIFICATION_NOT_ALLOWED,
            details: `El permiso '${existingPermission.name}' debe mantener su estado de sistema`
          });
        }
      }

      // 3. Validar nombre único si se está actualizando
      if (updatePermissionInput.name && updatePermissionInput.name !== existingPermission.name) {
        const duplicatePermission = await queryRunner.manager.findOne(Permission, {
          where: { name: updatePermissionInput.name }
        });

        if (duplicatePermission) {
          this.logger.warn(`Intento de actualizar permiso con nombre duplicado: ${updatePermissionInput.name}`);
          throw new CustomError({
            message: `Ya existe un permiso con el nombre: ${updatePermissionInput.name}`,
            statusCode: HttpStatus.CONFLICT,
            errorCode: PermissionErrorCode.PERMISSION_ALREADY_EXISTS,
            details: `No se puede cambiar el nombre porque ya existe otro permiso con ese nombre`
          });
        }
      }

      // 4. Procesar dependencias usando la misma lógica que CREATE
      let dependentPermissions: Permission[] = [];
      if (updatePermissionInput.dependsOn !== undefined) {
        if (updatePermissionInput.dependsOn && updatePermissionInput.dependsOn.length > 0) {
          this.logger.debug(
            `Validando dependencias para actualización del permiso '${existingPermission.name}': ${updatePermissionInput.dependsOn.map(d => d.id).join(', ')}`
          );

          dependentPermissions = await queryRunner.manager.find(Permission, {
            where: { id: In(updatePermissionInput.dependsOn.map(dep => dep.id)) }
          });

          if (dependentPermissions.length !== updatePermissionInput.dependsOn.length) {
            const foundIds = dependentPermissions.map(p => p.id);
            const missingIds = updatePermissionInput.dependsOn.filter(dep => !foundIds.includes(dep.id)).map(dep => dep.id);

            throw new CustomError({
              message: `Los siguientes permisos de dependencia no existen: ${missingIds.join(', ')}`,
              statusCode: HttpStatus.BAD_REQUEST,
              errorCode: PermissionErrorCode.PERMISSION_NOT_EXISTS,
              details: `Permisos no encontrados: ${missingIds.join(', ')}`
            });
          }

          // Validar dependencias circulares usando el servicio existente
          try {
            await this.dependencyService.validateCircularDependency(
              id,
              updatePermissionInput.dependsOn.map(dep => dep.id)
            );
          } catch (error: any) {
            throw new CustomError({
              message: `No se puede actualizar el permiso debido a dependencia circular: ${error.message}`,
              statusCode: HttpStatus.BAD_REQUEST,
              errorCode: PermissionErrorCode.CIRCULAR_DEPENDENCY_DETECTED,
              details: `No se puede actualizar el permiso debido a dependencia circular: ${error.message}`
            });
          }
        }
      } else {
        // Si dependsOn es undefined, mantener las dependencias actuales
        dependentPermissions = existingPermission.dependsOn || [];
      }

      this.logger.log(`Actualizando permiso: ${existingPermission.name} (ID: ${id})`);

      // 5. Actualizar los campos del permiso (solo los que se proporcionaron)
      const updateData: Partial<Permission> = {
        updatedAt: new Date(),
      };

      // Aplicar solo los campos que se proporcionaron
      if (updatePermissionInput.name !== undefined) updateData.name = updatePermissionInput.name;
      if (updatePermissionInput.description !== undefined) updateData.description = updatePermissionInput.description;
      if (updatePermissionInput.level !== undefined) updateData.level = updatePermissionInput.level;
      if (updatePermissionInput.isSystem !== undefined) updateData.isSystem = updatePermissionInput.isSystem;
      if (updatePermissionInput.label !== undefined) updateData.label = updatePermissionInput.label;
      if (updatePermissionInput.group !== undefined) updateData.group = updatePermissionInput.group;

      // 6. Actualizar el permiso y sus dependencias
      await queryRunner.manager.update(Permission, { id }, updateData);

      // 7. Actualizar las relaciones de dependencias si se modificaron
      if (updatePermissionInput.dependsOn !== undefined) {
        const updatedPermission = await queryRunner.manager.findOne(Permission, {
          where: { id },
          relations: ['dependsOn']
        });

        updatedPermission.dependsOn = dependentPermissions;
        await queryRunner.manager.save(Permission, updatedPermission);
      }

      // 8. Obtener el permiso actualizado completo
      const finalPermission = await queryRunner.manager.findOne(Permission, {
        where: { id },
        relations: ['dependsOn']
      });

      await queryRunner.commitTransaction();

      this.logger.log(`Permiso actualizado exitosamente: ${finalPermission.id} - ${finalPermission.name}`);

      // 9. Mapear respuesta usando el mismo patrón que CREATE
      const response: UpdatePermissionResponse = {
        id: finalPermission.id,
        name: finalPermission.name,
        description: finalPermission.description,
        status: finalPermission.status,
        level: finalPermission.level,
        isSystem: finalPermission.isSystem,
        label: finalPermission.label,
        group: finalPermission.group,
        dependsOn: finalPermission.dependsOn?.map(dep => ({
          id: dep.id,
          name: dep.name,
          description: dep.description
        })) || [],
        updatedAt: finalPermission.updatedAt,
        createdAt: finalPermission.createdAt,
      };

      return response;

    } catch (error: any) {
      await queryRunner.rollbackTransaction();

      this.logger.error(`Error al actualizar permiso '${id}': ${error.message}`, error.stack);
      if (error instanceof CustomError || error instanceof GraphQLError) {
        throw error;
      }

      throw new CustomError({
        message: `Error al actualizar el permiso: ${error.message}`,
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorCode: GeneralErrorCode.INTERNAL_SERVER_ERROR,
        details: `Error técnico durante la actualización del permiso: ${error.message}`
      });

    } finally {
      this.logger.debug(`Recursos de QueryRunner liberados para actualización del permiso: ${id}`);
      await queryRunner.release();
    }
  }

 async remove(id: string): Promise<RemovePermissionResponse> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    //! validar el rol del usuario que intenta eliminar el permiso, dependiendo del miso debe permitir o no la eliminacion del permiso
    try {
      // 1. Verificar si el permiso existe
      const existingPermission = await queryRunner.manager.findOne(Permission, {
        where: { id },
        relations: ['dependsOn']
      });

      if (!existingPermission) {
        this.logger.warn(`Intento de eliminar permiso inexistente: ${id}`);
        throw new CustomError({
          message: `Permiso con ID ${id} no encontrado`,
          statusCode: HttpStatus.NOT_FOUND,
          errorCode: PermissionErrorCode.PERMISSION_NOT_EXISTS,
          details: `No se puede eliminar un permiso que no existe: ${id}`
        });
      }

      // 2. Verificar si ya está eliminado (soft delete)
      if (!existingPermission.status) {
        this.logger.warn(`Intento de eliminar permiso ya eliminado: ${existingPermission.name} (${id})`);
        throw new CustomError({
          message: `El permiso '${existingPermission.name}' ya está eliminado`,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: PermissionErrorCode.PERMISSION_ALREADY_DELETED,
          details: `El permiso ya se encuentra en estado eliminado (status: false)`
        });
      }

      // 3. Verificar si es un permiso del sistema crítico
      if (existingPermission.isSystem) {
        this.logger.warn(`Intento de eliminar permiso crítico del sistema: ${existingPermission.name}`);
        throw new CustomError({
          message: `No se puede eliminar permisos críticos del sistema`,
          statusCode: HttpStatus.FORBIDDEN,
          errorCode: PermissionErrorCode.SYSTEM_PERMISSION_DELETION_NOT_ALLOWED,
          details: `El permiso '${existingPermission.name}' es crítico para el funcionamiento del sistema y no puede ser eliminado`
        });
      }

      // 4. Verificar si otros permisos dependen de este (impacto de eliminación)
      const dependentPermissions = await queryRunner.manager
        .createQueryBuilder(Permission, 'permission')
        .leftJoinAndSelect('permission.dependsOn', 'dependency')
        .where('dependency.id = :permissionId', { permissionId: id })
        .andWhere('permission.status = :status', { status: true })
        .getMany();

      if (dependentPermissions.length > 0) {
        const dependentNames = dependentPermissions.map(p => p.name).join(', ');
        this.logger.warn(
          `Intento de eliminar permiso con dependencias activas: ${existingPermission.name}. Dependientes: ${dependentNames}`
        );

        throw new CustomError({
          message: `No se puede eliminar el permiso porque otros permisos dependen de él`,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: PermissionErrorCode.PERMISSION_HAS_ACTIVE_DEPENDENCIES,
          details: `Los siguientes permisos activos dependen de '${existingPermission.name}': ${dependentNames}. Elimine o modifique estas dependencias primero.`
        });
      }

      // 5. Verificar si hay usuarios o roles que tengan este permiso asignado
      const activeAssignments = await this.checkActivePermissionAssignments(queryRunner, id);
      if (activeAssignments.hasActiveAssignments) {
        this.logger.warn(
          `Intento de eliminar permiso con asignaciones activas: ${existingPermission.name}. ` +
          `Usuarios: ${activeAssignments.userCount}, Roles: ${activeAssignments.roleCount}`
        );

        throw new CustomError({
          message: `No se puede eliminar el permiso porque está asignado a usuarios o roles activos`,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: PermissionErrorCode.PERMISSION_HAS_ACTIVE_ASSIGNMENTS,
          details: `El permiso '${existingPermission.name}' está asignado a ${activeAssignments.userCount} usuarios y ${activeAssignments.roleCount} roles. Revoque estas asignaciones antes de eliminar el permiso.`
        });
      }

      this.logger.log(`Eliminando permiso (soft delete): ${existingPermission.name} (ID: ${id})`);

      // 6. Realizar soft delete cambiando status a false

      const updateData: Partial<Permission> = {
        status: false,
        updatedAt: new Date(),
      };

      await queryRunner.manager.update(Permission, { id }, updateData);

      // 7. Obtener el permiso actualizado
      const deletedPermission = await queryRunner.manager.findOne(Permission, {
        where: { id },
        relations: ['dependsOn']
      });

      await queryRunner.commitTransaction();

      this.logger.log(`Permiso eliminado exitosamente (soft delete): ${deletedPermission.id} - ${deletedPermission.name}`);

      // 8. Mapear respuesta
      const response: RemovePermissionResponse = {
        id: deletedPermission.id,
        name: deletedPermission.name,
        description: deletedPermission.description,
        status: deletedPermission.status,
        level: deletedPermission.level,
        isSystem: deletedPermission.isSystem,
        labbel: deletedPermission.label,
        group: deletedPermission.group,
        dependsOn: deletedPermission.dependsOn?.map(dep => ({
          id: dep.id,
          name: dep.name,
          description: dep.description
        })) || [],
        deletedAt: deletedPermission.updatedAt,
        createdAt: deletedPermission.createdAt,
        message: `Permiso '${deletedPermission.name}' eliminado correctamente`
      };

      return response;

    } catch (error: any) {
      await queryRunner.rollbackTransaction();

      if (error instanceof CustomError || error instanceof GraphQLError) {
        throw error;
      }

      this.logger.error(`Error al eliminar permiso '${id}': ${error.message}`, error.stack);

      throw new CustomError({
        message: `Error al eliminar el permiso: ${error.message}`,
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorCode: GeneralErrorCode.INTERNAL_SERVER_ERROR,
        details: `Error técnico durante la eliminación del permiso: ${error.message}`
      });

    } finally {
      await queryRunner.release();
      this.logger.debug(`Recursos de QueryRunner liberados para eliminación del permiso: ${id}`);
    }
  }

async restore(id: string): Promise<RestorePermissionResponse> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    //! validar el rol del usuario para permitir o no la restauracion del permiso
    try {
      // 1. Verificar si el permiso existe
      const existingPermission = await queryRunner.manager.findOne(Permission, {
        where: { id },
        relations: ['dependsOn']
      });

      if (!existingPermission) {
        throw new CustomError({
          message: `Permiso con ID ${id} no encontrado`,
          statusCode: HttpStatus.NOT_FOUND,
          errorCode: PermissionErrorCode.PERMISSION_NOT_EXISTS
        });
      }

      // 2. Verificar si ya está activo
      if (existingPermission.status) {
        throw new CustomError({
          message: `El permiso '${existingPermission.name}' ya está activo`,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: PermissionErrorCode.PERMISSION_ALREADY_ACTIVE,
          details: `El permiso no necesita ser restaurado porque ya está activo`
        });
      }

      this.logger.log(`Restaurando permiso: ${existingPermission.name} (ID: ${id})`);

      // 3. Restaurar el permiso
      const updateData: Partial<Permission> = {
        status: true,
        updatedAt: new Date(),
      };

      await queryRunner.manager.update(Permission, { id }, updateData);

      const restoredPermission = await queryRunner.manager.findOne(Permission, {
        where: { id },
        relations: ['dependsOn']
      });

      await queryRunner.commitTransaction();

      this.logger.log(`Permiso restaurado exitosamente: ${restoredPermission.id} - ${restoredPermission.name}`);

      const response: RestorePermissionResponse = {
        id: restoredPermission.id,
        name: restoredPermission.name,
        description: restoredPermission.description,
        status: restoredPermission.status,
        level: restoredPermission.level,
        isSystem: restoredPermission.isSystem,
        label: restoredPermission.label,
        group: restoredPermission.group,
        dependsOn: restoredPermission.dependsOn?.map(dep => ({
          id: dep.id,
          name: dep.name,
          description: dep.description
        })) || [],
        restoredAt: restoredPermission.updatedAt,
        createdAt: restoredPermission.createdAt,
        message: `Permiso '${restoredPermission.name}' restaurado correctamente`
      };

      return response;

    } catch (error: any) {
      await queryRunner.rollbackTransaction();

      if (error instanceof CustomError || error instanceof GraphQLError) {
        throw error;
      }

      throw new CustomError({
        message: `Error al restaurar el permiso: ${error.message}`,
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorCode: GeneralErrorCode.INTERNAL_SERVER_ERROR
      });

    } finally {
      await queryRunner.release();
    }
  }


  private async checkActivePermissionAssignments(
    queryRunner: any,
    permissionId: string
  ): Promise<{ hasActiveAssignments: boolean, userCount: number, roleCount: number }> {

    //! Verificar asignaciones en usuarios (ajustar según tu esquema de BD)
    // const userAssignments = await queryRunner.manager
    //   .createQueryBuilder()
    //   .select('COUNT(*)', 'count')
    //   .from('role_permissions', 'up') // Ajustar nombre de tabla según tu esquema
    //   .where('up.permission_id = :permissionId', { permissionId })
    //   .andWhere('up.status = :status', { status: true }) // Si tienes status en la relación
    //   .getRawOne();

    // Verificar asignaciones en roles (ajustar según tu esquema de BD)
    // const roleAssignments = await queryRunner.manager
    //   .createQueryBuilder()
    //   .select('COUNT(*)', 'count')
    //   .from('role_permissions', 'rp') // Ajustar nombre de tabla según tu esquema
    //   .where('rp.permission_id = :permissionId', { permissionId })
    //   .andWhere('rp.status = :status', { status: true }) // Si tienes status en la relación
    //   .getRawOne();

    // const userCount = parseInt(userAssignments?.count || '0');
    // const roleCount = parseInt(roleAssignments?.count || '0');

    return {
      hasActiveAssignments: 0 > 0 || 0 > 0, //userCount, roleCount
      userCount: 0,
      roleCount: 0
    };
  }



}

import { HttpStatus, Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { hash } from 'bcrypt';
import { randomBytes } from 'crypto';

import { User } from './entities/user.entity';
import { UserRole } from './entities/user_has_roles.entity';
import { UserComplexAssignment, AssignmentStatus } from './entities/user-complex-assignment.entity';
import { UserStatus } from './enums/user.enums';
import { CreateStaffMemberResponse, StaffMemberAction } from './dto/responses/create-staff-member.response';
import { UpdateUserInput } from './dto/update-user.input';
import { ChangePasswordInput } from './dto/inputs/change-password.input';
import { ChangePasswordResponse } from './dto/responses/change-password.response';
import { UserInfoCompleteResponse } from './dto/responses/user-info-complete.response';
import { UsersFilterInput } from './dto/inputs/users-filter.input';
import { UsersListResponse } from './dto/responses/users-list.response';
import { CreateAdminUserInput } from './dto/inputs/create-admin-user.input';
import { CreateResidentUserInput } from './dto/inputs/create-resident-user.input';
import { CreateStaffMemberInput, STAFF_ROLES } from './dto/inputs/create-staff-member.input';
import { RemoveStaffMemberInput } from './dto/inputs/remove-staff-member.input';
import { RemoveStaffMemberResponse, RemoveStaffAction } from './dto/responses/remove-staff-member.response';
import { ExcelImportProducer } from './queues/excel-import.producer';
import { RolesService } from '../roles/roles.service';
import { Role } from '../roles/entities/role.entity';
import { ValidRoles } from '../roles/enums/valid-roles';
import { Unit } from '../residential-complex/entities/unit.entity';
import { ResidentialComplex } from '../residential-complex/entities/residential-complex.entity';
import { Resident } from '../residents/entities/resident.entity';
import { ResidentStatus } from '../residents/enums/resident-status.enum';
import { ResidentType } from '../residents/enums/resident-type.enum';
import { CustomError } from '../shared/utils/errors.utils';
import { GeneralErrorCode, UserErrorCode } from '../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../auth/interfaces/jwt-payload.interface';
import { GraphQLError } from 'graphql/error';
import { AuditService } from '../audit/services/audit.service';
import { AuditAction } from '../audit/enums/audit-action.enum';
import { AuditEntityType } from '../audit/enums/audit-entity-type.enum';

/** Roles que inician sesión con email + contraseña */
const PASSWORD_BASED_ROLES = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPILANCE_OFFICER_ROL,
  ValidRoles.COMPLEX_ROL,
  ValidRoles.ACCOUNTANT_ROL,
  ValidRoles.SUPERVISOR_ROL,
  ValidRoles.SECURITY_ROL,
];

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,

    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,

    @InjectRepository(Unit)
    private readonly unitRepo: Repository<Unit>,

    @InjectRepository(Resident)
    private readonly residentRepo: Repository<Resident>,

    @InjectRepository(ResidentialComplex)
    private readonly complexRepo: Repository<ResidentialComplex>,

    @InjectRepository(UserComplexAssignment)
    private readonly assignmentRepo: Repository<UserComplexAssignment>,

    private readonly rolesService: RolesService,
    private readonly dataSource: DataSource,
    private readonly excelImportProducer: ExcelImportProducer,
    private readonly auditService: AuditService,
  ) { }


  // ── Consultas ────────────────────────────────────────────────────────────

  async findAll(filter: UsersFilterInput = {}): Promise<UsersListResponse> {
    const { status, complexId, limit = 20, offset = 0 } = filter;

    const where: Record<string, any> = {};
    if (complexId) where.complexId = complexId;

    if (status) where.status = status;

    const [items, total] = await this.userRepo.findAndCount({
      where,
      relations: { userRoles: { role: true } },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { items, total, limit, offset };
  }

  async findUserByPhone(phoneNumber: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { phoneNumber } });
  }

  async findUserByEmail(email: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { email: email.toLowerCase().trim() } });
  }

  async getMyProfile(payload: JwtAccessPayload): Promise<User | ResidentialComplex> {
    if (payload.entityType === 'complex') {
      const complex = await this.complexRepo.findOne({
        where: { id: payload.sub },
        relations: ['owner', 'owner.userRoles', 'owner.userRoles.role'],
      });

      if (!complex || complex.deletedAt) {
        throw new CustomError({
          message: 'Complejo no encontrado',
          statusCode: HttpStatus.NOT_FOUND,
          errorCode: UserErrorCode.USER_NOT_FOUND,
        });
      }

      return complex;
    }

    const user = await this.userRepo.findOne({
      where: { id: payload.sub },
      relations: ['userRoles', 'userRoles.role'],
    });

    if (!user) {
      throw new CustomError({
        message: 'Usuario no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: UserErrorCode.USER_NOT_FOUND,
      });
    }

    return user;
  }

  async findOne(id: string, caller?: JwtAccessPayload): Promise<UserInfoCompleteResponse | null> {
    try {
      const qb = this.userRepo
        .createQueryBuilder('user')
        .leftJoinAndSelect('user.userRoles', 'userRoles')
        .leftJoinAndSelect('userRoles.role', 'role')
        .leftJoinAndSelect('role.permissions', 'permissions')
        .where('user.id = :id', { id });

      const isSuperAdmin = caller?.roles?.includes(ValidRoles.SUPER_ADMIN_ROL);
      if (!isSuperAdmin && caller?.complexId) {
        qb.andWhere('user.complexId = :complexId', { complexId: caller.complexId });
      }

      const user = await qb.getOne();

      if (!user) {
        throw new CustomError({
          message: 'El usuario no está registrado',
          statusCode: HttpStatus.NOT_FOUND,
          errorCode: UserErrorCode.USER_NOT_FOUND,
        });
      }

      user.userRoles = this.getEffectiveUserRoles(user);
      return user;
    } catch (error: any) {
      if (error instanceof CustomError || error instanceof GraphQLError) throw error;

      throw new CustomError({
        message: `Error al buscar un usuario: ${error.message}`,
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorCode: GeneralErrorCode.INTERNAL_SERVER_ERROR,
      });
    }
  }

  // ── Creación de usuarios administrativos ─────────────────────────────────

  /**
   * Crea un usuario con rol administrativo (COMPLIANCE, COMPLEX, etc.).
   * Solo un SUPER_ADMIN puede ejecutar esta operación.
   */
  async createAdminUser(
    input: CreateAdminUserInput,
    createdByUserId: string,
    currentUser?: JwtAccessPayload,
  ): Promise<User> {
    await this.assertEmailNotTaken(input.email);
    await this.assertPhoneNotTaken(input.phoneNumber);

    const role = await this.findRoleOrFail(input.role);

    const user = await this.dataSource.transaction(async (manager) => {
      const newUser = manager.create(User, {
        name: input.name,
        lastName: input.lastName,
        email: input.email,
        password: input.password, // el BeforeInsert hook de User hashea la contraseña
        phoneNumber: input.phoneNumber,
        identity: input.identity,
        complexId: input.complexId,
        status: UserStatus.ACTIVE,
        phoneVerified: false,
        emailVerified: false,
        identityVerified: false,
        acceptTermsAdnConditions: false,
        acceptsMarketing: false,
      });

      const saved = await manager.save(User, newUser);

      await manager.save(
        manager.create(UserRole, {
          user: { id: saved.id },
          role: { id: role.id },
          isPrimary: true,
        }),
      );

      return saved;
    });

    this.logger.log(`Usuario administrativo creado: ${user.id} | rol: ${input.role} | por: ${createdByUserId}`);

    if (currentUser) {
      void this.auditService.log({

        entityType: AuditEntityType.User,
        entityId: user.id,
        action: AuditAction.CREATE,
        newValue: { id: user.id, email: user.email, role: input.role, complexId: input.complexId },
        performedById: currentUser.sub,
        performedByName: currentUser.email,
        performedByRole: currentUser.roles?.[0] ?? '',
        complexId: input.complexId,
        description: `Usuario administrativo creado: ${user.email} — rol: ${input.role}`,
      });
    }

    return user;
  }

  // ── Registro individual de residentes ────────────────────────────────────

  /**
   * Registra un residente individualmente.
   * Solo el administrador del complejo (COMPLEX_ROL) puede hacerlo.
   */
  async createResidentUser(
    input: CreateResidentUserInput,
    adminUserId: string,
    currentUser?: JwtAccessPayload,
  ): Promise<User> {
    await this.assertPhoneNotTaken(input.phoneNumber);

    if (input.email) {
      await this.assertEmailNotTaken(input.email);
    }

    // Verificar que la unidad exista y pertenezca al complejo
    const unit = await this.unitRepo.findOne({
      where: { id: input.unitId, complexId: input.complexId },
    });

    if (!unit) {
      throw new BadRequestException(
        'La unidad especificada no existe o no pertenece al complejo',
      );
    }

    const residentRole = await this.findRoleOrFail(ValidRoles.RESIDENT_ROL);
    const systemCode = this.generateSystemCode();
    const email = input.email?.trim().toLowerCase()
      ?? `resident.${input.phoneNumber}@entrylink.local`;

    const user = await this.dataSource.transaction(async (manager) => {
      const dummyPassword = await hash(randomBytes(32).toString('hex'), 10);

      const newUser = manager.create(User, {
        name: input.name,
        lastName: input.lastName,
        email,
        password: dummyPassword,
        phoneNumber: input.phoneNumber,
        identity: input.identityNumber,
        systemCode,
        complexId: input.complexId,
        status: UserStatus.ACTIVE,
        phoneVerified: false,
        emailVerified: false,
        identityVerified: false,
        acceptTermsAdnConditions: false,
        acceptsMarketing: false,
      });

      const savedUser = await manager.save(User, newUser);

      await manager.save(
        manager.create(UserRole, {
          user: { id: savedUser.id },
          role: { id: residentRole.id },
          isPrimary: true,
        }),
      );

      await manager.save(
        manager.create(Resident, {
          userId: savedUser.id,
          unitId: input.unitId,
          complexId: input.complexId,
          type: ResidentType.OWNER,
          status: ResidentStatus.PENDING_APPROVAL,
          startDate: new Date(),
          isMainResident: false,
        }),
      );

      return savedUser;
    });

    this.logger.log(
      `Residente registrado: ${user.id} | unidad: ${input.unitId} | systemCode: ${systemCode} | por: ${adminUserId}`,
    );

    if (currentUser) {
      void this.auditService.log({

        entityType: AuditEntityType.User,
        entityId: user.id,
        action: AuditAction.CREATE,
        newValue: { id: user.id, phoneNumber: input.phoneNumber, unitId: input.unitId, complexId: input.complexId },
        performedById: currentUser.sub,
        performedByName: currentUser.email,
        performedByRole: currentUser.roles?.[0] ?? '',
        complexId: input.complexId,
        description: `Residente registrado: ${user.name} ${user.lastName} — unidad: ${input.unitId}`,
      });
    }

    return user;
  }

  // ── Creación / reintegración de personal del complejo ────────────────────

  /**
   * Crea o reintegra un miembro del personal del complejo.
   *
   * Casos:
   *  - Usuario nuevo                  → crea usuario + rol + asignación  (CREATED)
   *  - SECURITY_ROL sin asignación activa → reintegra al usuario         (REINTEGRATED)
   *  - SUPERVISOR/ACCOUNTANT en nuevo complejo → agrega asignación       (ADDED_TO_COMPLEX)
   */
  async createStaffMember(
    input: CreateStaffMemberInput,
    adminUserId: string,
    currentUser?: JwtAccessPayload,
  ): Promise<CreateStaffMemberResponse> {
    if (!(STAFF_ROLES as readonly string[]).includes(input.role)) {
      throw new CustomError({
        message: `El rol '${input.role}' no está permitido. Roles válidos: ${STAFF_ROLES.join(', ')}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    const role = await this.findRoleOrFail(input.role);
    const normalizedEmail = input.email.toLowerCase().trim();

    // ── PASO 1: buscar usuario por email ─────────────────────────────────
    const existingUser = await this.userRepo.findOne({
      where: { email: normalizedEmail },
      relations: ['userRoles', 'userRoles.role'],
    });

    // ── PASO 2: usuario NUEVO ────────────────────────────────────────────
    if (!existingUser) {
      await this.assertPhoneNotTaken(input.phoneNumber);

      const user = await this.dataSource.transaction(async (manager) => {
        const newUser = manager.create(User, {
          name:                     input.name,
          lastName:                 input.lastName,
          email:                    normalizedEmail,
          password:                 input.password,
          phoneNumber:              input.phoneNumber,
          identity:                 input.identityNumber,
          complexId:                input.complexId,
          status:                   UserStatus.ACTIVE,
          phoneVerified:            false,
          emailVerified:            false,
          identityVerified:         false,
          acceptTermsAdnConditions: false,
          acceptsMarketing:         false,

        });
        const saved = await manager.save(User, newUser);

        await manager.save(
          manager.create(UserRole, {

            user: { id: saved.id },
            role: { id: role.id },
            isPrimary: true,
          }),
        );

        await manager.save(
          manager.create(UserComplexAssignment, {
            userId: saved.id,
            complexId: input.complexId,
            role: input.role,
            status: AssignmentStatus.ACTIVE,
          }),
        );

        return saved;

      });

      this.logger.log(`Personal creado: ${user.id} | rol: ${input.role} | complejo: ${input.complexId} | por: ${adminUserId}`);
      void this.auditService.log({
        entityType: AuditEntityType.User,
        entityId: user.id,
        action: AuditAction.CREATE,
        newValue: { id: user.id, email: normalizedEmail, role: input.role, complexId: input.complexId },
        performedById: currentUser?.sub ?? adminUserId,
        performedByName: currentUser?.email,
        performedByRole: currentUser?.roles?.[0] ?? '',
        complexId: input.complexId,
        description: `Personal creado: ${normalizedEmail} — rol: ${input.role}`,
      });

      return {
        id: user.id,
        name: user.name,
        lastName: user.lastName,
        email: user.email,
        phoneNumber: user.phoneNumber,
        identity: user.identity,
        complexId: user.complexId, status: user.status, action: StaffMemberAction.CREATED
      };
    }

    // ── PASO 3: usuario EXISTENTE — rama según rol ────────────────────────

    // ── SECURITY_ROL: un solo complejo activo a la vez ────────────────────
    if (input.role === ValidRoles.SECURITY_ROL) {
      const activeAssignment = await this.assignmentRepo.findOne({
        where: { userId: existingUser.id, role: ValidRoles.SECURITY_ROL, status: AssignmentStatus.ACTIVE },
      });

      if (activeAssignment) {
        if (activeAssignment.complexId === input.complexId) {
          throw new ConflictException('Este guardia ya está asignado a este complejo');
        }
        throw new ConflictException('Este guardia ya está activo en otro complejo residencial');
      }

      // Reintegrar
      const updates: Partial<User> = { complexId: input.complexId };
      const needsRestore = existingUser.status === UserStatus.INACTIVE || existingUser.status === UserStatus.DELETED;
      if (needsRestore) {

        updates.status = UserStatus.ACTIVE;
        updates.deletedAt = null as any;
      }
      if (input.phoneNumber && !existingUser.phoneNumber) updates.phoneNumber = input.phoneNumber;
      if (input.identityNumber && !existingUser.identity) updates.identity = input.identityNumber;


      await this.dataSource.transaction(async (manager) => {
        await manager.update(User, existingUser.id, updates);

        const alreadyHasRole = existingUser.userRoles?.some(ur => ur.role?.name === ValidRoles.SECURITY_ROL);
        if (!alreadyHasRole) {
          await manager.save(
            manager.create(UserRole, { user: { id: existingUser.id }, role: { id: role.id }, isPrimary: false }),
          );
        }

        await manager.save(
          manager.create(UserComplexAssignment, {

            userId: existingUser.id,
            complexId: input.complexId,
            role: input.role,
            status: AssignmentStatus.ACTIVE,
          }),
        );
      });

      const reintegratedUser = { ...existingUser, ...updates };
      this.logger.log(`Personal reintegrado: ${existingUser.id} | rol: ${input.role} | complejo: ${input.complexId} | por: ${adminUserId}`);
      void this.auditService.log({

        entityType: AuditEntityType.User,
        entityId: existingUser.id,
        action: AuditAction.ACTIVATE,
        newValue: { complexId: input.complexId, role: input.role, action: StaffMemberAction.REINTEGRATED },
        performedById: currentUser?.sub ?? adminUserId,
        performedByName: currentUser?.email,
        performedByRole: currentUser?.roles?.[0] ?? '',
        complexId: input.complexId,
        description: `Personal reintegrado: ${existingUser.email} — rol: ${input.role}`,
      });

      return {
        id: existingUser.id,
        name: reintegratedUser.name,
        lastName: reintegratedUser.lastName,
        email: existingUser.email,
        phoneNumber: reintegratedUser.phoneNumber ?? existingUser.phoneNumber,
        identity: reintegratedUser.identity,
        complexId: input.complexId,
        status: reintegratedUser.status ?? existingUser.status, action: StaffMemberAction.REINTEGRATED
      };
    }

    // ── SUPERVISOR_ROL / ACCOUNTANT_ROL: pueden estar en N complejos ─────
    const existingActiveAssignment = await this.assignmentRepo.findOne({
      where: {

        userId: existingUser.id,
        complexId: input.complexId,
        role: input.role,
        status: AssignmentStatus.ACTIVE,
      },
    });

    if (existingActiveAssignment) {
      throw new ConflictException('Este usuario ya está asignado a este complejo con ese cargo');
    }

    await this.dataSource.transaction(async (manager) => {
      const alreadyHasRole = existingUser.userRoles?.some(ur => ur.role?.name === input.role);
      if (!alreadyHasRole) {
        await manager.save(
          manager.create(UserRole, { user: { id: existingUser.id }, role: { id: role.id }, isPrimary: false }),
        );
      }

      await manager.save(
        manager.create(UserComplexAssignment, {
        userId: existingUser.id,
        complexId: input.complexId,
        role: input.role,
        status: AssignmentStatus.ACTIVE,
        }),
      );
    });

    this.logger.log(`Personal asignado a nuevo complejo: ${existingUser.id} | rol: ${input.role} | complejo: ${input.complexId} | por: ${adminUserId}`);
    void this.auditService.log({

      entityType: AuditEntityType.User,
      entityId: existingUser.id,
      action: AuditAction.UPDATE,
      newValue: { complexId: input.complexId, role: input.role, action: StaffMemberAction.ADDED_TO_COMPLEX },
      performedById: currentUser?.sub ?? adminUserId,
      performedByName: currentUser?.email,
      performedByRole: currentUser?.roles?.[0] ?? '',
      complexId: input.complexId,
      description: `Personal asignado a complejo adicional: ${existingUser.email} — rol: ${input.role}`,
    });

    return {
      id: existingUser.id,
      name: existingUser.name,
      lastName: existingUser.lastName,
      email: existingUser.email,
      phoneNumber: existingUser.phoneNumber,
      identity: existingUser.identity,
      complexId: existingUser.complexId,
      status: existingUser.status,
      action: StaffMemberAction.ADDED_TO_COMPLEX
    };
  }

  // ── Eliminación de personal del complejo ─────────────────────────────────

  /**
   * Revoca la asignación de un miembro del personal de un complejo específico.
   *
   * Lógica:
   *  - Marca la UserComplexAssignment como REMOVED
   *  - Si el usuario no tiene otras asignaciones activas para ese rol → quita el UserRole
   *  - Si no tiene RESIDENT_ROL ni otras asignaciones activas → cambia status a INACTIVE
   *  - Para SECURITY_ROL → limpia user.complexId
   *  - Nunca hace soft-delete del usuario (queda disponible para reintegración)
   */
  async removeStaffMember(
    input: RemoveStaffMemberInput,
    adminUserId: string,
    currentUser?: JwtAccessPayload,
  ): Promise<RemoveStaffMemberResponse> {
    // 1. Cargar usuario con sus roles
    const user = await this.userRepo.findOne({
      where: { id: input.userId },
      relations: ['userRoles', 'userRoles.role'],
    });

    if (!user) {
      throw new CustomError({
        message: 'Usuario no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: UserErrorCode.USER_NOT_FOUND,
      });
    }

    if (user.status === UserStatus.DELETED) {
      throw new CustomError({
        message: 'El usuario ya fue eliminado del sistema',
        statusCode: HttpStatus.CONFLICT,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    // 2. Buscar la asignación activa específica (userId + complexId + role)
    const assignment = await this.assignmentRepo.findOne({
      where: {
        userId: input.userId,
        complexId: input.complexId,
        role: input.role,
        status: AssignmentStatus.ACTIVE,
      },
    });

    if (!assignment) {
      throw new CustomError({
        message: `El usuario no tiene una asignación activa como ${input.role} en este complejo`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    // 3. Verificar residencia activa (para preservar RESIDENT_ROL)
    const activeResidency = await this.residentRepo.findOne({
      where: [
        { userId: input.userId, status: ResidentStatus.ACTIVE },
        { userId: input.userId, status: ResidentStatus.PENDING_APPROVAL },
        { userId: input.userId, status: ResidentStatus.SUSPENDED },
      ],
      select: ['id'],
    });

    // 4. ¿Tiene otras asignaciones activas del mismo rol en otros complejos?
    const otherActiveAssignmentsForRole = await this.assignmentRepo.count({
      where: {
        userId: input.userId,
        role: input.role,
        status: AssignmentStatus.ACTIVE,
        id: Not(assignment.id),
      },
    });

    // 5. ¿Tiene cualquier otra asignación activa (cualquier rol, cualquier complejo)?
    const totalOtherActiveAssignments = await this.assignmentRepo.count({
      where: {
        userId: input.userId,
        status: AssignmentStatus.ACTIVE,
        id: Not(assignment.id),
      },
    });

    const hasResidentRole = (user.userRoles ?? []).some(
      ur => ur.role?.name === ValidRoles.RESIDENT_ROL,
    );
    const userRoleToRemove = (user.userRoles ?? []).find(
      ur => ur.role?.name === input.role,
    );

    await this.dataSource.transaction(async (manager) => {
      // a. Marcar asignación como REMOVED
      await manager.update(UserComplexAssignment, assignment.id, {
        status: AssignmentStatus.REMOVED,
        removedAt: new Date(),
      });

      // b. Quitar UserRole si no tiene otras asignaciones activas para ese rol
      if (otherActiveAssignmentsForRole === 0 && userRoleToRemove) {
        await manager.remove(UserRole, userRoleToRemove);
      }

      // c. Para SECURITY_ROL → limpiar complexId del usuario
      const userUpdates: Partial<User> = {};
      if (input.role === ValidRoles.SECURITY_ROL) {
        userUpdates.complexId = null as any;
      }

      // d. Si no tiene residencia ni otras asignaciones → pasar a INACTIVE
      const remainsActive = activeResidency || totalOtherActiveAssignments > 0;
      if (!remainsActive && user.status === UserStatus.ACTIVE) {
        userUpdates.status = UserStatus.INACTIVE;
      }

      if (Object.keys(userUpdates).length > 0) {
        await manager.update(User, input.userId, userUpdates);
      }
    });

    const action = hasResidentRole || totalOtherActiveAssignments > 0
      ? RemoveStaffAction.STAFF_ROLE_REMOVED
      : RemoveStaffAction.USER_DELETED; // semántica: "dado de baja del personal" (no se borra el registro)

    const message = hasResidentRole
      ? 'Rol de personal revocado. El usuario continúa activo como residente.'
      : totalOtherActiveAssignments > 0
        ? 'Asignación revocada para este complejo. El usuario mantiene sus otras asignaciones activas.'
        : 'Personal dado de baja. El usuario queda inactivo y puede ser reintegrado en el futuro.';

    this.logger.log(
      `Personal removido: usuario ${input.userId} | rol: ${input.role} | complejo: ${input.complexId} | por: ${adminUserId}`,
    );
    void this.auditService.log({

      entityType: AuditEntityType.User,
      entityId: input.userId,
      action: AuditAction.UPDATE,
      previousValue: { role: input.role, complexId: input.complexId, status: AssignmentStatus.ACTIVE },
      newValue: { role: input.role, complexId: input.complexId, status: AssignmentStatus.REMOVED, action },
      performedById: currentUser?.sub ?? adminUserId,
      performedByName: currentUser?.email,
      performedByRole: currentUser?.roles?.[0] ?? '',
      complexId: input.complexId,
      description: `Rol ${input.role} revocado del usuario ${input.userId} en complejo ${input.complexId}`,
    });

    return { success: true, action, message };
  }

  // ── Actualización de usuario ─────────────────────────────────────────────

  async updateUser(input: UpdateUserInput, callerComplexId?: string, currentUser?: JwtAccessPayload): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { id: input.userId },
      relations: ['userRoles', 'userRoles.role'],
    });

    if (!user) {
      throw new CustomError({
        message: 'Usuario no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: UserErrorCode.USER_NOT_FOUND,
      });
    }

    if (user.status === UserStatus.DELETED) {
      throw new CustomError({
        message: 'No se puede editar un usuario eliminado',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    if (callerComplexId && user.complexId !== callerComplexId) {
      throw new CustomError({
        message: 'No tienes permisos para editar usuarios de otro complejo',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: GeneralErrorCode.FORBIDDEN,
      });
    }

    if (input.name !== undefined) user.name = input.name;
    if (input.lastName !== undefined) user.lastName = input.lastName;

    if (input.phoneNumber !== undefined) user.phoneNumber = input.phoneNumber;

    if (input.role !== undefined) {
      const role = await this.roleRepo.findOne({ where: { name: input.role as any } });

      if (!role) {
        throw new CustomError({
          message: `Rol "${input.role}" no encontrado`,
          statusCode: HttpStatus.NOT_FOUND,
          errorCode: GeneralErrorCode.BAD_REQUEST,
        });
      }

      const existing = user.userRoles?.find(ur => ur.isPrimary);
      if (existing) {
        await this.userRoleRepo.update(existing.id, { role });
      } else {
        await this.userRoleRepo.save(
          this.userRoleRepo.create({ user: { id: user.id }, role, isPrimary: true }),
        );
      }
    }

    const updated = await this.userRepo.save(user);
    this.logger.log(`Usuario actualizado: ${user.id}`);

    if (currentUser) {
      void this.auditService.log({
        entityType: AuditEntityType.User,
        entityId: user.id,
        action: AuditAction.UPDATE,
        newValue: { name: input.name, lastName: input.lastName, phoneNumber: input.phoneNumber, role: input.role },
        performedById: currentUser.sub,
        performedByName: currentUser.email,
        performedByRole: currentUser.roles?.[0] ?? '',
        complexId: user.complexId,
        description: `Usuario actualizado: ${user.email}`,
      });
    }

    return updated;
  }

  // ── Gestión de estado de usuarios ────────────────────────────────────────

  async suspendUser(userId: string, reason: string, callerComplexId?: string, currentUser?: JwtAccessPayload): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id: userId } });

    if (!user) {
      throw new CustomError({
        message: 'Usuario no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: UserErrorCode.USER_NOT_FOUND,
      });
    }

    if (callerComplexId && user.complexId !== callerComplexId) {
      throw new CustomError({
        message: 'No tienes permisos para suspender usuarios de otro complejo',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: GeneralErrorCode.FORBIDDEN,
      });
    }

    if (user.status === UserStatus.SUSPENDED || user.status === UserStatus.DELETED) {
      throw new CustomError({
        message: `No se puede suspender un usuario con estado "${user.status}"`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    user.status = UserStatus.SUSPENDED;
    user.suspensionReason = reason;
    const updated = await this.userRepo.save(user);
    this.logger.warn(`Usuario suspendido: ${userId} — motivo: ${reason}`);

    if (currentUser) {
      void this.auditService.log({
        entityType: AuditEntityType.User,
        entityId: userId,
        action: AuditAction.SUSPEND,
        previousValue: { status: UserStatus.ACTIVE },
        newValue: { status: UserStatus.SUSPENDED, reason },
        performedById: currentUser.sub,
        performedByName: currentUser.email,
        performedByRole: currentUser.roles?.[0] ?? '',
        complexId: user.complexId,
        description: `Usuario suspendido: ${user.email} — motivo: ${reason}`,
      });
    }

    return updated;
  }

  async reactivateUser(userId: string, callerComplexId?: string, currentUser?: JwtAccessPayload): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id: userId } });

    if (!user) {
      throw new CustomError({
        message: 'Usuario no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: UserErrorCode.USER_NOT_FOUND,
      });
    }

    if (callerComplexId && user.complexId !== callerComplexId) {
      throw new CustomError({
        message: 'No tienes permisos para reactivar usuarios de otro complejo',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: GeneralErrorCode.FORBIDDEN,
      });
    }

    if (user.status !== UserStatus.SUSPENDED) {
      throw new CustomError({
        message: `Solo se pueden reactivar usuarios suspendidos. Estado actual: "${user.status}"`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    user.status = UserStatus.ACTIVE;
    user.suspensionReason = null;
    const updated = await this.userRepo.save(user);
    this.logger.log(`Usuario reactivado: ${userId}`);

    if (currentUser) {
      void this.auditService.log({
        entityType: AuditEntityType.User,
        entityId: userId,
        action: AuditAction.ACTIVATE,
        previousValue: { status: UserStatus.SUSPENDED },
        newValue: { status: UserStatus.ACTIVE },
        performedById: currentUser.sub,
        performedByName: currentUser.email,
        performedByRole: currentUser.roles?.[0] ?? '',
        complexId: user.complexId,
        description: `Usuario reactivado: ${user.email}`,
      });
    }

    return updated;
  }

  async restoreUser(userId: string, currentUser?: JwtAccessPayload): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id: userId } });

    if (!user) {
      throw new CustomError({
        message: 'Usuario no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: UserErrorCode.USER_NOT_FOUND,
      });
    }

    if (user.status !== UserStatus.DELETED) {
      throw new CustomError({
        message: `El usuario no está eliminado. Estado actual: "${user.status}"`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    user.status = UserStatus.ACTIVE;
    user.deletedAt = null;

    const updated = await this.userRepo.save(user);
    this.logger.log(`Usuario restaurado: ${userId}`);

    if (currentUser) {
      void this.auditService.log({
        entityType: AuditEntityType.User,
        entityId: userId,
        action: AuditAction.RESTORE,
        previousValue: { status: UserStatus.DELETED },
        newValue: { status: UserStatus.ACTIVE },
        performedById: currentUser.sub,
        performedByName: currentUser.email,
        performedByRole: currentUser.roles?.[0] ?? '',
        complexId: user.complexId,
        description: `Usuario restaurado: ${user.email}`,
      });
    }

    return updated;
  }

  async deleteUser(userId: string, currentUser?: JwtAccessPayload): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id: userId } });

    if (!user) {
      throw new CustomError({
        message: 'Usuario no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: UserErrorCode.USER_NOT_FOUND,
      });
    }

    if (user.status === UserStatus.DELETED) {
      throw new CustomError({
        message: 'El usuario ya fue eliminado',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    user.status = UserStatus.DELETED;
    user.deletedAt = new Date();

    const updated = await this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(User, user);

      // Limpiar legalRepresentativeId solo si el complejo aún apunta a este usuario.
      // Si el frontend ya asignó un nuevo representante antes de llamar deleteUser,
      // el FK ya cambió y esta query no afecta ningún registro.
      await manager.update(
        ResidentialComplex,
        { legalRepresentativeId: userId },
        { legalRepresentativeId: null },
      );

      return saved;
    });

    this.logger.warn(`Usuario eliminado (soft): ${userId}`);

    if (currentUser) {
      void this.auditService.log({
        entityType: AuditEntityType.User,
        entityId: userId,
        action: AuditAction.DELETE,
        previousValue: { status: user.status },
        newValue: { status: UserStatus.DELETED, deletedAt: updated.deletedAt },
        performedById: currentUser.sub,
        performedByName: currentUser.email,
        performedByRole: currentUser.roles?.[0] ?? '',
        complexId: user.complexId,
        description: `Usuario eliminado (soft-delete): ${user.email}`,
      });
    }

    return updated;
  }

  // ── Importación masiva por Excel ──────────────────────────────────────────

  /**
   * Encola un trabajo BullMQ para procesar un archivo Excel de residentes.
   * Retorna el importId para que el cliente pueda consultar el estado.
   */
  async bulkImportResidents(
    filePath: string,
    complexId: string,
    adminUserId: string,
  ): Promise<string> {
    const importId = await this.excelImportProducer.enqueueResidentImport(
      filePath,
      complexId,
      adminUserId,
    );

    this.logger.log(`Importación masiva encolada — importId: ${importId}`);
    return importId;
  }

  // ── Cambio de contraseña ─────────────────────────────────────────────────

  async changePassword(
    id: string,
    { currentPassword, newPassword, confirmPassword }: ChangePasswordInput,
  ): Promise<ChangePasswordResponse> {
    if (newPassword !== confirmPassword) {
      throw new CustomError({
        message: 'La nueva contraseña y su confirmación no coinciden',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    if (currentPassword === newPassword) {
      throw new CustomError({
        message: 'La nueva contraseña debe ser diferente a la actual',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    const user = await this.userRepo.findOne({
      where: { id },
      select: ['id', 'email', 'password'],
    });

    if (!user) {
      throw new CustomError({
        message: 'Usuario no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: UserErrorCode.USER_NOT_FOUND,
      });
    }

    const { compare } = await import('bcrypt');
    const isValid = await compare(currentPassword, user.password);

    if (!isValid) {
      throw new CustomError({
        message: 'La contraseña actual es incorrecta',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    const hashed = await hash(newPassword, 12);
    await this.userRepo.update(id, {
      password: hashed,
      lastPasswordChange: new Date(),
      tokenVersion: () => '"tokenVersion" + 1', // Invalida todos los tokens activos
    });

    return {
      success: true,
      message: 'Contraseña cambiada exitosamente',
      changedAt: new Date(),
    };
  }

  // ── Helpers públicos ─────────────────────────────────────────────────────

  public getEffectiveUserRoles(user: User): UserRole[] {
    const userRoles = user.userRoles ?? [];

    const hasResidentRole = userRoles.some(
      ur => ur.role?.name === ValidRoles.RESIDENT_ROL,
    );

    if (!hasResidentRole) {
      const virtual = this.rolesService.createVirtualUserRole(user.id);
      virtual.isPrimary = userRoles.length === 0;
      return [virtual, ...userRoles];
    }

    return userRoles;
  }

  // ── Helpers privados ─────────────────────────────────────────────────────

  private async assertEmailNotTaken(email: string): Promise<void> {
    const exists = await this.userRepo.findOne({
      where: { email: email.toLowerCase().trim() },
      select: ['id'],
    });

    if (exists) {
      throw new ConflictException(`El correo '${email}' ya está registrado en el sistema`);
    }
  }

  private async assertPhoneNotTaken(phoneNumber: string): Promise<void> {
    const exists = await this.userRepo.findOne({
      where: { phoneNumber: phoneNumber.trim() },
      select: ['id'],
    });

    if (exists) {
      throw new ConflictException(
        `El número de celular '${phoneNumber}' ya está registrado en el sistema`,
      );
    }
  }

  async updateProfilePicture(userId: string, url: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id: userId } });

    if (!user) {
      throw new CustomError({
        message: 'Usuario no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: UserErrorCode.USER_NOT_FOUND,
      });
    }

    await this.userRepo.update(userId, { profilePicture: url });
    user.profilePicture = url;
    return user;
  }

  private async findRoleOrFail(roleName: ValidRoles): Promise<Role> {
    const role = await this.roleRepo.findOne({ where: { name: roleName } });

    if (!role) {
      throw new BadRequestException(`El rol '${roleName}' no está configurado en el sistema`);
    }

    return role;
  }

  /** Genera un código de sistema legible (ej: RES-A3F9-K2M1) */
  private generateSystemCode(): string {
    const p1 = randomBytes(2).toString('hex').toUpperCase();
    const p2 = randomBytes(2).toString('hex').toUpperCase();
    return `RES-${p1}-${p2}`;
  }
}

import { HttpStatus, Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { hash } from 'bcrypt';
import { randomBytes } from 'crypto';

import { User } from './entities/user.entity';
import { UserRole } from './entities/user_has_roles.entity';
import { UserStatus } from './enums/user.enums';
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
import { Resident } from '../residents/entities/resident.entity';
import { ResidentStatus } from '../residents/enums/resident-status.enum';
import { ResidentType } from '../residents/enums/resident-type.enum';
import { CustomError } from '../shared/utils/errors.utils';
import { GeneralErrorCode, UserErrorCode } from '../shared/constans/error-codes.constants';
import { GraphQLError } from 'graphql/error';

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

    private readonly rolesService: RolesService,
    private readonly dataSource: DataSource,
    private readonly excelImportProducer: ExcelImportProducer,
  ) {}

  // ── Consultas ────────────────────────────────────────────────────────────

  async findAll(filter: UsersFilterInput = {}): Promise<UsersListResponse> {
    const { status, complexId, limit = 20, offset = 0 } = filter;

    const qb = this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.userRoles', 'userRoles')
      .leftJoinAndSelect('userRoles.role', 'role')
      .orderBy('user.createdAt', 'DESC')
      .take(limit)
      .skip(offset);

    if (status) {
      qb.andWhere('user.status = :status', { status });
    }

    if (complexId) {
      qb.andWhere('user.complexId = :complexId', { complexId });
    }

    const [items, total] = await qb.getManyAndCount();

    return { items, total, limit, offset };
  }

  async findUserByPhone(phoneNumber: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { phoneNumber } });
  }

  async findUserByEmail(email: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { email: email.toLowerCase().trim() } });
  }

  async getMyProfile(userId: string): Promise<UserInfoCompleteResponse> {
    const user = await this.userRepo.findOne({ where: { id: userId }, relations: ['userRoles', 'userRoles.role'] });

    if (!user) {
      throw new CustomError({
        message: 'Usuario no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: UserErrorCode.USER_NOT_FOUND,
      });
    }

    return user;
  }

  async findOne(id: string): Promise<UserInfoCompleteResponse | null> {
    try {
      const user = await this.userRepo
        .createQueryBuilder('user')
        .leftJoinAndSelect('user.userRoles', 'userRoles')
        .leftJoinAndSelect('userRoles.role', 'role')
        .leftJoinAndSelect('role.permissions', 'permissions')
        .where('user.id = :id', { id })
        .getOne();

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
      ?? `resident.${input.phoneNumber}@residash.local`;

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

    return user;
  }

  // ── Creación de personal del complejo ────────────────────────────────────

  /**
   * Crea un miembro del personal del complejo (guardia, supervisor, contador).
   * El rol llega desde el frontend; solo se permiten SECURITY_ROL, SUPERVISOR_ROL, ACCOUNTANT_ROL.
   * Solo el COMPLEX_ROL o SUPER_ADMIN pueden ejecutar esta operación.
   */
  async createStaffMember(
    input: CreateStaffMemberInput,
    adminUserId: string,
  ): Promise<User> {
    if (!(STAFF_ROLES as readonly string[]).includes(input.role)) {
      throw new CustomError({
        message: `El rol '${input.role}' no está permitido. Roles válidos: ${STAFF_ROLES.join(', ')}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    await this.assertEmailNotTaken(input.email);
    await this.assertPhoneNotTaken(input.phoneNumber);

    const role = await this.findRoleOrFail(input.role);

    const user = await this.dataSource.transaction(async (manager) => {
      const newUser = manager.create(User, {
        name: input.name,
        lastName: input.lastName,
        email: input.email,
        password: input.password,
        phoneNumber: input.phoneNumber,
        identity: input.identityNumber,
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

    this.logger.log(
      `Personal creado: ${user.id} | rol: ${input.role} | complejo: ${input.complexId} | por: ${adminUserId}`,
    );
    return user;
  }

  // ── Eliminación de personal del complejo ─────────────────────────────────

  /**
   * Elimina a un miembro del personal de un complejo.
   *
   * Lógica:
   * - Si el usuario tiene residencia activa en CUALQUIER complejo
   *   (status PENDING_APPROVAL, ACTIVE o SUSPENDED) → solo se le quitan los
   *   roles de personal (SECURITY, SUPERVISOR, ACCOUNTANT) y se limpia su
   *   complexId. El usuario conserva el RESIDENT_ROL y sigue activo.
   * - Si NO tiene ninguna residencia activa → soft delete del usuario.
   */
  async removeStaffMember(
    input: RemoveStaffMemberInput,
    adminUserId: string,
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

    if (user.deletedAt) {
      throw new CustomError({
        message: 'El usuario ya fue eliminado del sistema',
        statusCode: HttpStatus.CONFLICT,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    // 2. Verificar que el usuario pertenece al complejo indicado
    if (user.complexId !== input.complexId) {
      throw new CustomError({
        message: 'El usuario no pertenece al complejo indicado',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: GeneralErrorCode.FORBIDDEN,
      });
    }

    // 3. Identificar roles de personal que se deben quitar
    const staffRolesToRemove = (user.userRoles ?? []).filter(
      (ur) => ur.role && (STAFF_ROLES as readonly string[]).includes(ur.role.name),
    );

    if (staffRolesToRemove.length === 0) {
      throw new CustomError({
        message: 'El usuario no tiene ningún rol de personal asignado en este complejo',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    // 4. Verificar si el usuario tiene residencia activa en algún complejo
    const activeResidency = await this.residentRepo.findOne({
      where: [
        { userId: input.userId, status: ResidentStatus.ACTIVE },
        { userId: input.userId, status: ResidentStatus.PENDING_APPROVAL },
        { userId: input.userId, status: ResidentStatus.SUSPENDED },
      ],
      select: ['id'],
    });

    await this.dataSource.transaction(async (manager) => {
      // Quitar todos los roles de personal del usuario
      await manager.remove(staffRolesToRemove);

      if (activeResidency) {
        // Solo limpiar el complexId de staff — el usuario sigue activo como residente
        await manager.update(User, input.userId, { complexId: null });
      } else {
        // Sin residencia activa → eliminar físicamente del sistema

        // 1. Limpiar OTP codes (columna plana sin FK a nivel de constraint)
        await manager.query(
          `DELETE FROM otp_codes WHERE user_id = $1`,
          [input.userId],
        );

        // 2. Eliminar todos los roles restantes del usuario (por si el usuario tenía otros roles)
        await manager.query(
          `DELETE FROM user_has_roles WHERE user_id = $1`,
          [input.userId],
        );

        // 3. Hard delete del usuario.
        //    - user_sessions, refresh_tokens → CASCADE definido en la entidad
        //    - packages.registeredByUserId, packages.deliveredByUserId → SET NULL (corregido en entity)
        //    - payments.registeredByUserId → SET NULL (corregido en entity)
        //    - notes, visits, visitors, vehicles (campos auditoria) → SET NULL
        await manager.query(
          `DELETE FROM users WHERE id = $1`,
          [input.userId],
        );
      }
    });

    if (activeResidency) {
      this.logger.log(
        `Personal removido (conserva residencia): usuario ${input.userId} | complejo ${input.complexId} | por ${adminUserId}`,
      );
      return {
        success: true,
        action:  RemoveStaffAction.STAFF_ROLE_REMOVED,
        message: 'Rol de personal eliminado. El usuario continúa activo como residente.',
      };
    }

    this.logger.warn(
      `Usuario eliminado FÍSICAMENTE del sistema: ${input.userId} | complejo ${input.complexId} | por ${adminUserId}`,
    );
    return {
      success: true,
      action:  RemoveStaffAction.USER_DELETED,
      message: 'El usuario fue eliminado del sistema al no tener residencia activa en ningún complejo.',
    };
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

  update(id: number, updateUserInput: UpdateUserInput) {
    return `This action updates a #${id} user`;
  }

  remove(id: number) {
    return `This action removes a #${id} user`;
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

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
import { CreateAdminUserInput } from './dto/inputs/create-admin-user.input';
import { CreateResidentUserInput } from './dto/inputs/create-resident-user.input';
import { CreateSecurityGuardInput } from './dto/inputs/create-security-guard.input';
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

    @InjectRepository(Unit)
    private readonly unitRepo: Repository<Unit>,

    @InjectRepository(Resident)
    private readonly residentRepo: Repository<Resident>,

    private readonly rolesService: RolesService,
    private readonly dataSource: DataSource,
    private readonly excelImportProducer: ExcelImportProducer,
  ) {}

  // ── Consultas ────────────────────────────────────────────────────────────

  findAll() {
    return `This action returns all users`;
  }

  async findUserByPhone(phoneNumber: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { phoneNumber } });
  }

  async findUserByEmail(email: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { email: email.toLowerCase().trim() } });
  }

  async getMyProfile(userId: string): Promise<UserInfoCompleteResponse> {
    const user = await this.userRepo.findOne({ where: { id: userId } });

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

  // ── Creación de guardias de seguridad ─────────────────────────────────────

  /**
   * Crea un guardia de seguridad asignado a un complejo.
   * Solo el COMPLEX_ROL puede hacerlo.
   */
  async createSecurityGuard(
    input: CreateSecurityGuardInput,
    adminUserId: string,
  ): Promise<User> {
    await this.assertEmailNotTaken(input.email);
    await this.assertPhoneNotTaken(input.phoneNumber);

    const role = await this.findRoleOrFail(ValidRoles.SECURITY_ROL);

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

    this.logger.log(`Guardia creado: ${user.id} | complejo: ${input.complexId} | por: ${adminUserId}`);
    return user;
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

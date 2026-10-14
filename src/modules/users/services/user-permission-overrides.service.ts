import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from '../entities/user.entity';
import { UserPermissionOverride } from '../entities/user-permission-override.entity';
import { PermissionOverrideEffect } from '../enums/permission-override-effect.enum';
import { UserStatus } from '../enums/user.enums';
import { SetUserPermissionOverrideInput } from '../dto/inputs/set-user-permission-override.input';
import {
  RolePermissionSource,
  UserPermissionsSummary,
} from '../dto/responses/user-permissions-summary.response';
import { Permission } from '../../permissions/entities/permission.entity';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { TokenService } from '../../auth/services/token.service';
import { JwtAccessPayload } from '../../auth/interfaces/jwt-payload.interface';
import { AuditService } from '../../audit/services/audit.service';
import { AuditAction } from '../../audit/enums/audit-action.enum';
import { AuditEntityType } from '../../audit/enums/audit-entity-type.enum';
import { CustomError } from '../../shared/utils/errors.utils';
import {
  PermissionErrorCode,
  UserErrorCode,
} from '../../shared/constans/error-codes.constants';

/**
 * Excepciones de permisos por usuario: dar o quitar un permiso a una persona
 * sin tocar su rol (ver `UserPermissionOverride`).
 *
 * Cada cambio sube el `tokenVersion` del usuario: su access token vigente deja
 * de valer, la app lo renueva y el nuevo ya sale con los permisos corregidos.
 * No hace falta cerrarle la sesión.
 */
@Injectable()
export class UserPermissionOverridesService {
  private readonly logger = new Logger(UserPermissionOverridesService.name);

  constructor(
    @InjectRepository(UserPermissionOverride)
    private readonly overrideRepo: Repository<UserPermissionOverride>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,
    private readonly tokenService: TokenService,
    private readonly auditService: AuditService,
  ) {}

  async summary(userId: string): Promise<UserPermissionsSummary> {
    const user = await this.findUser(userId);
    const overrides = await this.overrideRepo.find({
      where: { userId },
      relations: ['permission'],
      order: { createdAt: 'ASC' },
    });

    const byPermission = new Map<string, RolePermissionSource>();
    for (const ur of user.userRoles ?? []) {
      for (const permission of ur.role?.permissions ?? []) {
        const source = byPermission.get(permission.id) ?? {
          permission,
          roles: [],
        };
        source.roles.push(ur.role.name);
        byPermission.set(permission.id, source);
      }
    }

    const effective = new Set(
      [...byPermission.values()].map((s) => s.permission.name as string),
    );
    for (const o of overrides) {
      if (o.effect === PermissionOverrideEffect.DENY)
        effective.delete(o.permission.name);
      else effective.add(o.permission.name);
    }

    return {
      userId,
      rolePermissions: [...byPermission.values()].sort((a, b) =>
        a.permission.name.localeCompare(b.permission.name),
      ),
      overrides,
      effectivePermissions: [...effective].sort(),
      isSuperAdmin: this.isSuperAdmin(user),
    };
  }

  async set(
    input: SetUserPermissionOverrideInput,
    actor: JwtAccessPayload,
  ): Promise<UserPermissionOverride> {
    const user = await this.findUser(input.userId);
    this.assertNotSuperAdmin(user);

    const permission = await this.permissionRepo.findOne({
      where: { id: input.permissionId },
    });
    if (!permission) {
      throw new CustomError({
        message: 'Permiso no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: PermissionErrorCode.PERMISSION_NOT_FOUND,
      });
    }

    const existing = await this.overrideRepo.findOne({
      where: { userId: user.id, permissionId: permission.id },
    });
    const saved = await this.overrideRepo.save(
      this.overrideRepo.create({
        ...(existing ?? {}),
        userId: user.id,
        permissionId: permission.id,
        effect: input.effect,
        reason: input.reason?.trim() || null,
        createdById: actor.sub,
      }),
    );
    saved.permission = permission;

    await this.applyToSessions(user.id);
    this.audit(
      actor,
      user,
      existing ? AuditAction.UPDATE : AuditAction.CREATE,
      `${input.effect === PermissionOverrideEffect.DENY ? 'Se quitó' : 'Se dio'} el permiso ${permission.name} a ${user.email}`,
      existing
        ? { effect: existing.effect, reason: existing.reason }
        : undefined,
      {
        permission: permission.name,
        effect: input.effect,
        reason: saved.reason,
      },
    );

    this.logger.log(
      `Excepción ${input.effect} ${permission.name} → usuario ${user.id}`,
    );
    return saved;
  }

  async remove(
    userId: string,
    permissionId: string,
    actor: JwtAccessPayload,
  ): Promise<boolean> {
    const existing = await this.overrideRepo.findOne({
      where: { userId, permissionId },
      relations: ['permission', 'user'],
    });
    if (!existing) {
      throw new CustomError({
        message: 'Ese usuario no tiene una excepción para ese permiso',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: PermissionErrorCode.PERMISSION_OVERRIDE_NOT_FOUND,
      });
    }

    await this.overrideRepo.delete(existing.id);
    await this.applyToSessions(userId);
    this.audit(
      actor,
      existing.user,
      AuditAction.DELETE,
      `Se quitó la excepción del permiso ${existing.permission.name} a ${existing.user?.email ?? userId}`,
      { permission: existing.permission.name, effect: existing.effect },
      undefined,
    );
    return true;
  }

  private async findUser(userId: string): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['userRoles', 'userRoles.role', 'userRoles.role.permissions'],
    });
    if (!user || user.status === UserStatus.DELETED) {
      throw new CustomError({
        message: 'Usuario no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: UserErrorCode.USER_NOT_FOUND,
      });
    }
    return user;
  }

  private isSuperAdmin(user: User): boolean {
    return (user.userRoles ?? []).some(
      (ur) => ur.role?.name === ValidRoles.SUPER_ADMIN_ROL,
    );
  }

  /** El guard deja pasar al SUPER_ADMIN sin mirar permisos: la excepción no haría nada. */
  private assertNotSuperAdmin(user: User): void {
    if (this.isSuperAdmin(user)) {
      throw new CustomError({
        message:
          'El super administrador tiene acceso a todo: una excepción de permiso no lo afecta',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: PermissionErrorCode.PERMISSION_OVERRIDE_SUPER_ADMIN,
      });
    }
  }

  /** Invalida el access token vigente; el siguiente ya trae los permisos nuevos. */
  private async applyToSessions(userId: string): Promise<void> {
    await this.userRepo.update(userId, {
      tokenVersion: () => '"tokenVersion" + 1',
    });
    await this.tokenService.clearUserTokenVersionCache(userId);
  }

  private audit(
    actor: JwtAccessPayload,
    user: User | undefined,
    action: AuditAction,
    description: string,
    previousValue: Record<string, unknown> | undefined,
    newValue: Record<string, unknown> | undefined,
  ): void {
    void this.auditService.log({
      entityType: AuditEntityType.User,
      entityId: user?.id ?? '',
      action,
      previousValue,
      newValue,
      performedById: actor.sub,
      performedByName: actor.email,
      // Solo el SUPER_ADMIN llega aquí, pero su primer rol puede ser el de
      // residente, que la auditoría no registra.
      performedByRole: actor.roles?.includes(ValidRoles.SUPER_ADMIN_ROL)
        ? ValidRoles.SUPER_ADMIN_ROL
        : (actor.roles?.[0] ?? ''),
      complexId: user?.complexId ?? undefined,
      description,
    });
  }
}

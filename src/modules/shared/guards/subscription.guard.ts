import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { DataSource, IsNull } from 'typeorm';

import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { BK } from '../../../core/infrastructure/cache/business-cache.constants';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { SubscriptionStatus } from '../../subscriptions/enums/subscription-status.enum';
import { computeSubscriptionStatus } from '../../subscriptions/utils/subscription-status';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { CustomError } from '../utils/errors.utils';
import { SubscriptionErrorCode } from '../constans/error-codes.constants';

/**
 * Llave de metadata de `@AllowWhenSuspended`. Vive aquí y no en el decorador
 * por la misma razón que REQUIRED_MODULE_KEY: el decorador importa el guard y
 * al revés se armaría un ciclo.
 */
export const ALLOW_WHEN_SUSPENDED_KEY = 'allow_when_subscription_suspended';

/**
 * Roles de la administración del conjunto. Son los únicos a quienes afecta la
 * suspensión: la deuda es entre la administración y la plataforma.
 */
const ADMINISTRATION_ROLES: string[] = [
  ValidRoles.COMPLEX_ROL,
  ValidRoles.ACCOUNTANT_ROL,
];

/** Roles de la plataforma: nunca se bloquean, son quienes renuevan. */
const PLATFORM_ROLES: string[] = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPILANCE_OFFICER_ROL,
];

const READ_ONLY_METHODS = ['GET', 'HEAD', 'OPTIONS'];

type SessionUser = {
  sub?: string;
  roles?: string[];
  complexId?: string;
  entityType?: 'user' | 'complex';
};

/**
 * Con la suscripción suspendida, la administración queda en solo lectura.
 *
 * Bloquea solo ESCRITURAS (mutaciones GraphQL y métodos REST que no son GET)
 * de sesiones con rol de administración. Nunca toca a residentes, portería ni
 * supervisores, y deja pasar lo marcado con `@AllowWhenSuspended`: pánico,
 * sesión y notificaciones. Apagar un botón de pánico por una factura vencida
 * sería poner en riesgo a personas que no deben nada.
 *
 * Igual que ComplexModuleGuard, lee la base directo y cacheada, y falla
 * abierto: si Redis o la base fallan, nadie se queda sin plataforma por eso.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  private readonly logger = new Logger(SubscriptionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
    private readonly cacheService: CacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_WHEN_SUSPENDED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowed) return true;

    const { user, isWrite } = this.resolveContext(context);
    if (!user || !isWrite) return true;

    const roles = user.roles ?? [];
    if (roles.some((role) => PLATFORM_ROLES.includes(role))) return true;
    if (!roles.some((role) => ADMINISTRATION_ROLES.includes(role))) return true;

    // La cuenta del complejo inicia sesión con sub = complex.id.
    const complexId =
      user.complexId ?? (user.entityType === 'complex' ? user.sub : undefined);
    if (!complexId) return true;

    const endsAt = await this.loadEndsAt(complexId);
    if (endsAt === undefined) return true;

    if (computeSubscriptionStatus(endsAt) !== SubscriptionStatus.SUSPENDED) {
      return true;
    }

    throw new CustomError({
      message:
        'La suscripción del conjunto está suspendida por falta de pago. ' +
        'Puedes consultar la información, pero para hacer cambios debes renovarla. ' +
        'El botón de pánico, la portería y el control de acceso siguen funcionando.',
      statusCode: HttpStatus.FORBIDDEN,
      errorCode: SubscriptionErrorCode.SUBSCRIPTION_SUSPENDED,
    });
  }

  private resolveContext(context: ExecutionContext): {
    user?: SessionUser;
    isWrite: boolean;
  } {
    if (context.getType<string>() === 'graphql') {
      const gqlCtx = GqlExecutionContext.create(context);
      const req = gqlCtx.getContext<{ req?: { user?: SessionUser } }>()?.req;
      const operation = gqlCtx.getInfo<{ operation?: { operation?: string } }>()
        ?.operation?.operation;
      return { user: req?.user, isWrite: operation === 'mutation' };
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: SessionUser; method?: string }>();
    return {
      user: request?.user,
      isWrite: !READ_ONLY_METHODS.includes(
        (request?.method ?? 'GET').toUpperCase(),
      ),
    };
  }

  /**
   * Vencimiento vigente, cacheado. `null` = sin suscripción (no se bloquea);
   * `undefined` = no se pudo averiguar (falla abierta).
   */
  private async loadEndsAt(
    complexId: string,
  ): Promise<string | null | undefined> {
    const cacheKey = BK.complexSubscription.one(complexId);
    const cached = await this.cacheService.get<{ endsAt: string | null }>({
      key: cacheKey,
    });
    if (cached) return cached.endsAt;

    try {
      const complex = await this.dataSource
        .getRepository(ResidentialComplex)
        .findOne({
          where: { id: complexId, deletedAt: IsNull() },
          select: { id: true, subscriptionEndsAt: true },
        });
      const endsAt = complex?.subscriptionEndsAt
        ? new Date(complex.subscriptionEndsAt).toISOString()
        : null;

      await this.cacheService.set({
        key: cacheKey,
        data: { endsAt },
        options: { ttl: BK.complexSubscription.TTL },
      });
      return endsAt;
    } catch (err) {
      this.logger.warn(
        `No se pudo leer la suscripción de ${complexId}: ${(err as Error).message}`,
      );
      return undefined;
    }
  }
}

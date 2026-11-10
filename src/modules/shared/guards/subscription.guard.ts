import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { DataSource, IsNull } from 'typeorm';

import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { BK } from '../../../core/infrastructure/cache/business-cache.constants';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { ComplexStatus } from '../../residential-complex/enums/complex-status.enum';
import { SubscriptionStatus } from '../../subscriptions/enums/subscription-status.enum';
import {
  computeSubscriptionStatus,
  parseCutMode,
} from '../../subscriptions/utils/subscription-status';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { CustomError } from '../utils/errors.utils';
import {
  AuthErrorCode,
  SubscriptionErrorCode,
} from '../constans/error-codes.constants';

/**
 * Llave de metadata de `@AllowWhenSuspended`. Vive aquí y no en el decorador
 * por la misma razón que REQUIRED_MODULE_KEY: el decorador importa el guard y
 * al revés se armaría un ciclo.
 */
export const ALLOW_WHEN_SUSPENDED_KEY = 'allow_when_subscription_suspended';

/** Llave de metadata de `@PanicTrigger`: disparar una alerta de pánico. */
export const PANIC_TRIGGER_KEY = 'subscription_panic_trigger';

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

/**
 * Lo que el guard necesita del complejo. Comparte la llave `cpxsub` con el
 * vencimiento: suspender, reactivar o renovar la borran.
 */
type ComplexAccessState = {
  endsAt: string | null;
  status?: ComplexStatus;
  reason?: string | null;
  accessCutAt?: string | null;
  panicCutAt?: string | null;
};

/** Mensaje de la suspensión manual, con el motivo si lo hay. */
export function complexSuspendedMessage(reason?: string | null): string {
  const base = 'La cuenta del conjunto está suspendida por la plataforma.';
  return reason?.trim() ? `${base} Motivo: ${reason.trim()}` : base;
}

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
 * También aplica la suspensión manual (`ComplexStatus.SUSPENDED`), que es más
 * dura: bloquea lecturas y escrituras de la administración, menos lo marcado
 * con `@AllowWhenSuspended`. El login sí se permite para que la web pueda
 * mostrar el motivo; residentes y portería tampoco se tocan aquí.
 *
 * El corte por no renovar sí alcanza a toda la comunidad, solo con la marca que
 * deja SubscriptionCutService tras los tres avisos y según
 * `SUBSCRIPTION_CUT_MODE`. Lo marcado con `@AllowWhenSuspended` sigue abierto
 * para poder explicar el motivo, renovar y atender una alerta ya abierta.
 * Disparar una alerta nueva solo se bloquea con el corte del pánico.
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
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const allowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_WHEN_SUSPENDED_KEY,
      targets,
    );
    const panicTrigger = this.reflector.getAllAndOverride<boolean>(
      PANIC_TRIGGER_KEY,
      targets,
    );
    const mode = parseCutMode(
      this.configService.get<string>('SUBSCRIPTION_CUT_MODE'),
    );
    if (allowed && !(panicTrigger && mode === 'access_and_panic')) return true;

    const { user, isWrite } = this.resolveContext(context);
    if (!user) return true;

    const roles = user.roles ?? [];
    if (roles.some((role) => PLATFORM_ROLES.includes(role))) return true;
    const isAdministration = roles.some((role) =>
      ADMINISTRATION_ROLES.includes(role),
    );
    if (!isAdministration && mode === 'off') return true;

    // La cuenta del complejo inicia sesión con sub = complex.id.
    const complexId =
      user.complexId ?? (user.entityType === 'complex' ? user.sub : undefined);
    if (!complexId) return true;

    const state = await this.loadState(complexId);
    if (!state) return true;

    if (panicTrigger) {
      if (mode === 'access_and_panic' && state.panicCutAt) {
        throw new CustomError({
          message:
            'El botón de pánico está inactivo porque la administración no renovó la suscripción. En una emergencia marca 123.',
          statusCode: HttpStatus.FORBIDDEN,
          errorCode: SubscriptionErrorCode.SUBSCRIPTION_PANIC_CUT,
        });
      }
      return true;
    }

    if (mode !== 'off' && state.accessCutAt) {
      throw new CustomError({
        message:
          'La administración del conjunto no renovó la suscripción. El servicio está suspendido hasta que se renueve.',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: SubscriptionErrorCode.SUBSCRIPTION_ACCESS_CUT,
      });
    }

    if (!isAdministration) return true;

    // Suspensión manual del SUPER_ADMIN: a diferencia de la de pago, bloquea
    // también las lecturas. La web lleva a la pantalla de suspensión con el
    // motivo, y este error es la red por si alguien llama la API directo.
    if (state.status === ComplexStatus.SUSPENDED) {
      throw new CustomError({
        message: complexSuspendedMessage(state.reason),
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: AuthErrorCode.COMPLEX_SUSPENDED,
      });
    }

    if (!isWrite) return true;

    if (
      computeSubscriptionStatus(state.endsAt) !== SubscriptionStatus.SUSPENDED
    ) {
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
   * Estado del complejo y vencimiento vigente, cacheados. `undefined` = no se
   * pudo averiguar (falla abierta). `endsAt` nulo = sin suscripción.
   */
  private async loadState(
    complexId: string,
  ): Promise<ComplexAccessState | undefined> {
    const cacheKey = BK.complexSubscription.one(complexId);
    const cached = await this.cacheService.get<ComplexAccessState>({
      key: cacheKey,
    });
    if (cached) return cached;

    try {
      const complex = await this.dataSource
        .getRepository(ResidentialComplex)
        .findOne({
          where: { id: complexId, deletedAt: IsNull() },
          select: {
            id: true,
            status: true,
            suspensionReason: true,
            subscriptionEndsAt: true,
            subscriptionAccessCutAt: true,
            subscriptionPanicCutAt: true,
          },
        });
      const state: ComplexAccessState = {
        endsAt: complex?.subscriptionEndsAt
          ? new Date(complex.subscriptionEndsAt).toISOString()
          : null,
        status: complex?.status,
        reason: complex?.suspensionReason ?? null,
        accessCutAt: complex?.subscriptionAccessCutAt
          ? new Date(complex.subscriptionAccessCutAt).toISOString()
          : null,
        panicCutAt: complex?.subscriptionPanicCutAt
          ? new Date(complex.subscriptionPanicCutAt).toISOString()
          : null,
      };

      await this.cacheService.set({
        key: cacheKey,
        data: state,
        options: { ttl: BK.complexSubscription.TTL },
      });
      return state;
    } catch (err) {
      this.logger.warn(
        `No se pudo leer la suscripción de ${complexId}: ${(err as Error).message}`,
      );
      return undefined;
    }
  }
}

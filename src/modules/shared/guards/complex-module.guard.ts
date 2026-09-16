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
import { ComplexModule } from '../../residential-complex/enums/complex-module.enum';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { CustomError } from '../utils/errors.utils';
import { ComplexErrorCode } from '../constans/error-codes.constants';

/**
 * Llave de metadata del módulo exigido.
 *
 * Vive aquí y no en el decorador a propósito: el decorador importa el guard
 * para registrarlo, así que si el guard importara la llave de vuelta se armaría
 * un ciclo entre los dos archivos —y en un ciclo uno de los dos llega
 * `undefined`, que en un `UseGuards` tumba el arranque—.
 */
export const REQUIRED_MODULE_KEY = 'required_complex_module';

/** Nombres legibles para el mensaje de error. */
const MODULE_LABELS: Partial<Record<ComplexModule, string>> = {
  [ComplexModule.FINANZAS]: 'Finanzas',
  [ComplexModule.PAQUETES]: 'Paquetería',
  [ComplexModule.VISITAS]: 'Visitas',
  [ComplexModule.VEHICULOS]: 'Vehículos',
  [ComplexModule.ZONAS_COMUNES]: 'Zonas comunes',
  [ComplexModule.PQRF]: 'PQRF',
  [ComplexModule.VOTACIONES]: 'Votaciones',
  [ComplexModule.MASCOTAS]: 'Mascotas',
  [ComplexModule.MANTENIMIENTO]: 'Mantenimiento',
  [ComplexModule.NOTAS]: 'Notas',
  [ComplexModule.CLASIFICADOS]: 'Clasificados',
};

/**
 * Deja pasar solo si el complejo tiene encendido el módulo que atiende la
 * operación.
 *
 * Esconder la opción en el menú no es una regla: es una comodidad. Quien
 * conserve un enlace viejo, tenga la app abierta desde antes del cambio o
 * llame la API directo, entraba igual. Aquí es donde el interruptor del
 * SUPER_ADMIN se vuelve obligatorio.
 *
 * Consulta la base directo y no a `ResidentialComplexService` a propósito: este
 * guard vive en shared, que es de quien dependen todos los demás módulos.
 * Inyectar ese servicio cerraría el grafo de dependencias contra sí mismo.
 */
@Injectable()
export class ComplexModuleGuard implements CanActivate {
  private readonly logger = new Logger(ComplexModuleGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
    private readonly cacheService: CacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<ComplexModule>(
      REQUIRED_MODULE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required) return true;

    const { user, complexId } = this.resolveContext(context);

    // Sin usuario todavía no corrió el guard de sesión. Va sobre la CLASE, así
    // que Nest lo ejecuta ANTES que el `@Auth` del método: responder aquí
    // "ese módulo está apagado" le contaría a cualquiera sin token qué tiene
    // contratado el conjunto. Que conteste quien debe: el de autenticación.
    if (!user) return true;

    // El SUPER_ADMIN es quien mueve el interruptor: bloquearlo con su propio
    // interruptor lo dejaría sin poder volver a encenderlo desde el panel.
    if (user.roles?.includes(ValidRoles.SUPER_ADMIN_ROL)) return true;

    // Sin complejo no hay nada contra qué validar: la operación la frenan —o
    // no— los guards de rol y permiso, que corren igual.
    if (!complexId) return true;

    const modules = await this.loadModules(complexId);

    // Lista vacía o nula = todos habilitados. Es la misma regla del cliente y
    // del resto del servidor: un conjunto que nunca tocó la configuración no
    // puede quedarse sin plataforma.
    if (!modules || modules.length === 0) return true;

    if (modules.includes(required)) return true;

    throw new CustomError({
      message: `El módulo de ${MODULE_LABELS[required] ?? required} no está habilitado en este complejo`,
      statusCode: HttpStatus.FORBIDDEN,
      errorCode: ComplexErrorCode.COMPLEX_MODULE_DISABLED,
    });
  }

  /**
   * De dónde sale el complejo de la operación.
   *
   * El argumento manda sobre el JWT: el SUPER_ADMIN y el supervisor trabajan
   * sobre complejos que no son el suyo, y validar contra el del token dejaría
   * pasar lo que se pidió sobre otro.
   */
  private resolveContext(context: ExecutionContext): {
    user?: { roles?: string[]; complexId?: string };
    complexId?: string;
  } {
    const gqlCtx = GqlExecutionContext.create(context);
    const gqlContext = gqlCtx.getContext<{
      req?: { user?: { roles?: string[]; complexId?: string } };
    }>();
    const gqlRequest = gqlContext?.req;

    if (gqlRequest) {
      const args = gqlCtx.getArgs<Record<string, unknown>>();

      return {
        user: gqlRequest.user,
        complexId: this.readComplexId(args) ?? gqlRequest.user?.complexId,
      };
    }

    const request = context.switchToHttp().getRequest<{
      user?: { roles?: string[]; complexId?: string };
      body?: Record<string, unknown>;
      params?: Record<string, unknown>;
      query?: Record<string, unknown>;
    }>();

    return {
      user: request?.user,
      complexId:
        this.readComplexId(request?.body) ??
        this.readComplexId(request?.params) ??
        this.readComplexId(request?.query) ??
        request?.user?.complexId,
    };
  }

  /** `complexId` suelto o dentro del `input` de la mutación. */
  private readComplexId(source?: Record<string, unknown>): string | undefined {
    if (!source) return undefined;

    if (typeof source.complexId === 'string') return source.complexId;

    const input = source.input as Record<string, unknown> | undefined;
    if (input && typeof input.complexId === 'string') return input.complexId;

    return undefined;
  }

  /**
   * Los módulos del complejo, cacheados.
   *
   * Esto corre en CADA petición del módulo: sin caché serían dos consultas por
   * pantalla solo para preguntar lo mismo. Devuelve `null` cuando no se pudo
   * averiguar, y el guard trata ese caso como "déjalo pasar" (ver el catch).
   */
  private async loadModules(complexId: string): Promise<string[] | null> {
    const cacheKey = BK.complexModules.one(complexId);

    const cached = await this.cacheService.get<string[]>({ key: cacheKey });
    if (cached) return cached;

    try {
      // Se lee por el repositorio y no con SQL a mano: la columna de la entidad
      // es `enabledModules` en camelCase —el `@Column` no lleva `name`, así que
      // TypeORM la creó tal cual y en Postgres queda entrecomillada—. La
      // consulta cruda preguntaba por `enabled_modules`, que no existe: la base
      // respondía con un error, el catch de abajo lo tragaba y el guard dejaba
      // pasar todo. Dejando que TypeORM resuelva el nombre, el desfase no puede
      // repetirse.
      const complex = await this.dataSource
        .getRepository(ResidentialComplex)
        .findOne({
          where: { id: complexId, deletedAt: IsNull() },
          select: { id: true, enabledModules: true },
        });

      const modules = complex?.enabledModules ?? [];

      await this.cacheService.set({
        key: cacheKey,
        data: modules,
        options: { ttl: BK.complexModules.TTL },
      });

      return modules;
    } catch (err) {
      const error = err as Error;
      this.logger.warn(
        `No se pudieron leer los módulos de ${complexId}: ${error.message}`,
      );
      // Falla abierta: que Redis o la base tosan no puede dejar sin paquetería
      // a un conjunto que sí la tiene contratada.
      return null;
    }
  }
}

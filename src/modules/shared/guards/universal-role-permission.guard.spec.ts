// jest (CJS) no carga @nestjs/passport (ESM); el guard no lo necesita aquí.
jest.mock('@nestjs/passport', () => ({
  AuthGuard: () => class {},
  PassportStrategy: () => class {},
}));

import {
  ForbiddenException,
  HttpStatus,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { CustomError } from '../utils/errors.utils';
import { PermissionErrorCode } from '../constans/error-codes.constants';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { ValidPermissions as P } from '../../permissions/enums/valid-permissions';
import { PermissionStatusService } from '../../permissions/services/permission-status.service';
import {
  isPermissionInactive,
  resetInactivePermissions,
  setInactivePermissions,
} from '../permission-status/permission-status.registry';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { actorHas } from '../../growth/shared/growth-actor';
import { UniversalRolePermissionGuard } from './universal-role-permission.guard';

/** Operaciones de ejemplo con la misma metadata que pone `@Auth`. */
class Ops {
  @SetMetadata('permissions', [P.IMPORT_GROWTH_DATA])
  importar() {}

  @SetMetadata('permissions', [P.IMPORT_GROWTH_DATA, P.VIEW_GROWTH_ACTIVITY])
  dos() {}

  @SetMetadata('roles', [ValidRoles.GROWTH_MANAGER_ROL])
  soloRol() {}

  libre() {}
}

/**
 * Estado de los permisos controlado por la prueba: el mismo registro que
 * mantiene el servicio real.
 */
const status = {
  inactive: jest.fn(async () => {
    const { inactivePermissions } =
      await import('../permission-status/permission-status.registry');
    return inactivePermissions();
  }),
  inactiveRoleNames: jest.fn(async () => {
    const { inactiveRoles } =
      await import('../permission-status/permission-status.registry');
    return inactiveRoles();
  }),
} as unknown as PermissionStatusService;

const guard = new UniversalRolePermissionGuard(new Reflector(), status);

type User = { sub?: string; roles: string[]; permissions: string[] };
const user = (permissions: P[], roles: ValidRoles[] = []): User => ({
  sub: 'u1',
  roles,
  permissions,
});
const admin = user([], [ValidRoles.SUPER_ADMIN_ROL]);

/** GraphQL: el usuario viaja en el contexto (tercer argumento). */
function gql(op: keyof Ops, u: User | null) {
  const ctx = new ExecutionContextHost(
    [
      {},
      {},
      { req: { user: u ? { ...u, email: 'x@alternaqj.com' } : undefined } },
      {},
    ],
    Ops,
    Ops.prototype[op],
  );
  ctx.setType('graphql');
  return guard.canActivate(ctx);
}

/** REST: Express pone `res.req`; GqlExecutionContext toma `res` como contexto. */
function rest(op: keyof Ops, u: User | null) {
  const req = { user: u ? { ...u, email: 'x@alternaqj.com' } : undefined };
  const ctx = new ExecutionContextHost(
    [req, { req }, () => undefined],
    Ops,
    Ops.prototype[op],
  );
  return guard.canActivate(ctx);
}

describe('UniversalRolePermissionGuard — estado vigente de los permisos', () => {
  beforeEach(() => {
    resetInactivePermissions();
    setInactivePermissions([]);
    jest.clearAllMocks();
  });

  for (const [name, call] of [
    ['GraphQL', gql],
    ['REST', rest],
  ] as const) {
    describe(name, () => {
      it('1. rol activo con permiso activo: pasa', async () => {
        await expect(
          call('importar', user([P.IMPORT_GROWTH_DATA])),
        ).resolves.toBe(true);
      });

      it('2. permiso inactivo aunque venga en el token: no pasa', async () => {
        setInactivePermissions([P.IMPORT_GROWTH_DATA]);
        await expect(
          call('importar', user([P.IMPORT_GROWTH_DATA])),
        ).resolves.toBe(false);
      });

      it('3. permiso nuevo inactivo que nadie tiene: no pasa', async () => {
        setInactivePermissions([P.VIEW_GROWTH_ACTIVITY]);
        await expect(call('dos', user([P.IMPORT_GROWTH_DATA]))).resolves.toBe(
          false,
        );
      });

      it('4. al activarlo, con un token que ya lo trae, pasa', async () => {
        setInactivePermissions([P.IMPORT_GROWTH_DATA]);
        await expect(
          call('importar', user([P.IMPORT_GROWTH_DATA])),
        ).resolves.toBe(false);
        setInactivePermissions([]);
        await expect(
          call('importar', user([P.IMPORT_GROWTH_DATA])),
        ).resolves.toBe(true);
      });

      it('5 y 6. al desactivarlo, un token emitido antes deja de servir', async () => {
        const oldToken = user([P.IMPORT_GROWTH_DATA]);
        await expect(call('importar', oldToken)).resolves.toBe(true);
        setInactivePermissions([P.IMPORT_GROWTH_DATA]);
        await expect(call('importar', oldToken)).resolves.toBe(false);
      });

      it('8. SUPER_ADMIN pasa, y si usa un permiso inactivo queda en el log', async () => {
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        await expect(call('importar', admin)).resolves.toBe(true);
        expect(warn).not.toHaveBeenCalled();
        setInactivePermissions([P.IMPORT_GROWTH_DATA]);
        await expect(call('importar', admin)).resolves.toBe(true);
        expect(warn).toHaveBeenCalledWith(
          expect.stringMatching(
            /SUPER_ADMIN u1 usó Ops\.importar con permisos inactivos: \[IMPORT_GROWTH_DATA\]/,
          ),
        );
        warn.mockRestore();
      });

      it('10. sin el permiso, sin usuario o con otro rol: no pasa', async () => {
        await expect(call('importar', user([]))).resolves.toBe(false);
        await expect(
          call('soloRol', user([P.IMPORT_GROWTH_DATA])),
        ).resolves.toBe(false);
        await expect(call('importar', null)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
      });
    });
  }

  it('una operación libre no consulta el estado (sin costo)', async () => {
    await expect(gql('libre', user([]))).resolves.toBe(true);
    await expect(gql('libre', admin)).resolves.toBe(true);
    expect(status.inactive).not.toHaveBeenCalled();
  });

  describe('roles inactivos', () => {
    it('rol activo: la operación que lo exige pasa', async () => {
      setInactivePermissions([], Date.now(), []);
      await expect(
        gql('soloRol', user([], [ValidRoles.GROWTH_MANAGER_ROL])),
      ).resolves.toBe(true);
    });

    it('rol inactivo aunque venga en el token: no pasa', async () => {
      setInactivePermissions([], Date.now(), [ValidRoles.GROWTH_MANAGER_ROL]);
      await expect(
        gql('soloRol', user([], [ValidRoles.GROWTH_MANAGER_ROL])),
      ).resolves.toBe(false);
      await expect(
        rest('soloRol', user([], [ValidRoles.GROWTH_MANAGER_ROL])),
      ).resolves.toBe(false);
    });

    it('al reactivarlo, el mismo token vuelve a pasar', async () => {
      setInactivePermissions([], Date.now(), [ValidRoles.GROWTH_MANAGER_ROL]);
      const u = user([], [ValidRoles.GROWTH_MANAGER_ROL]);
      await expect(gql('soloRol', u)).resolves.toBe(false);
      setInactivePermissions([], Date.now(), []);
      await expect(gql('soloRol', u)).resolves.toBe(true);
    });

    it('SUPER_ADMIN_ROL inactivo (solo posible por SQL): no da el paso de administrador', async () => {
      setInactivePermissions([], Date.now(), [ValidRoles.SUPER_ADMIN_ROL]);
      await expect(gql('importar', admin)).resolves.toBe(false);
      await expect(gql('soloRol', admin)).resolves.toBe(false);
    });

    it('un rol inactivo no tapa a otro activo del mismo usuario', async () => {
      setInactivePermissions([], Date.now(), [ValidRoles.SALES_ROL]);
      await expect(
        gql(
          'soloRol',
          user([], [ValidRoles.SALES_ROL, ValidRoles.GROWTH_MANAGER_ROL]),
        ),
      ).resolves.toBe(true);
    });
  });

  it('si no se puede verificar el estado (base caída > 120 s), se niega con 503, también a SUPER_ADMIN', async () => {
    const unavailable = new CustomError({
      message: 'No se pudo verificar el estado de los permisos.',
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      errorCode: PermissionErrorCode.PERMISSION_STATUS_UNAVAILABLE,
    });
    (status.inactive as jest.Mock)
      .mockRejectedValueOnce(unavailable)
      .mockRejectedValueOnce(unavailable);
    await expect(
      gql('importar', user([P.IMPORT_GROWTH_DATA])),
    ).rejects.toMatchObject({
      errorCode: 'PERMISSION_STATUS_UNAVAILABLE',
    });
    await expect(gql('importar', admin)).rejects.toMatchObject({
      errorCode: 'PERMISSION_STATUS_UNAVAILABLE',
    });
    // Una operación sin permisos exigidos no depende del estado.
    await expect(gql('libre', user([]))).resolves.toBe(true);
  });

  it('la verificación de servicio (actorHas) también ignora un permiso inactivo; SUPER_ADMIN pasa', () => {
    const actor = {
      sub: 'u1',
      roles: [],
      permissions: [P.VIEW_ALL_GROWTH_PROSPECTS],
    } as never;
    expect(actorHas(actor, P.VIEW_ALL_GROWTH_PROSPECTS)).toBe(true);
    setInactivePermissions([P.VIEW_ALL_GROWTH_PROSPECTS]);
    expect(isPermissionInactive(P.VIEW_ALL_GROWTH_PROSPECTS)).toBe(true);
    expect(actorHas(actor, P.VIEW_ALL_GROWTH_PROSPECTS)).toBe(false);
    expect(
      actorHas(
        {
          sub: 'a',
          roles: [ValidRoles.SUPER_ADMIN_ROL],
          permissions: [],
        } as never,
        P.VIEW_ALL_GROWTH_PROSPECTS,
      ),
    ).toBe(true);
  });
});

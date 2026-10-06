import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { SubscriptionGuard } from './subscription.guard';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { CustomError } from '../utils/errors.utils';
import { ComplexStatus } from '../../residential-complex/enums/complex-status.enum';
import { AuthErrorCode } from '../constans/error-codes.constants';

/**
 * Con la suscripción suspendida, la administración queda en solo lectura. Lo
 * que importa probar es lo que NO se bloquea: residentes, portería, lecturas
 * y lo marcado con @AllowWhenSuspended (pánico, sesión, avisos).
 */
const COMPLEX_ID = '11111111-1111-1111-1111-111111111111';
const DAY = 86_400_000;
const suspendedEndsAt = new Date(Date.now() - 10 * DAY).toISOString();
const graceEndsAt = new Date(Date.now() - 2 * DAY).toISOString();

const build = (opts: {
  endsAt?: string | null;
  allowed?: boolean;
  dbFails?: boolean;
  status?: ComplexStatus;
  reason?: string | null;
}) => {
  const reflector = {
    getAllAndOverride: jest.fn(() => opts.allowed ?? false),
  } as unknown as Reflector;
  const findOne = jest.fn(async () => {
    if (opts.dbFails) throw new Error('base caída');
    return {
      id: COMPLEX_ID,
      subscriptionEndsAt: opts.endsAt ?? null,
      status: opts.status ?? ComplexStatus.ACTIVE,
      suspensionReason: opts.reason ?? null,
    };
  });
  const dataSource = { getRepository: () => ({ findOne }) } as never;
  const cache = { get: jest.fn(async () => null), set: jest.fn() } as never;
  return {
    guard: new SubscriptionGuard(reflector, dataSource, cache),
    findOne,
  };
};

const gqlContext = (
  user: Record<string, unknown> | undefined,
  operation: 'query' | 'mutation',
): ExecutionContext =>
  ({
    getType: () => 'graphql',
    getHandler: () => undefined,
    getClass: () => undefined,
    getArgs: () => [{}, {}, { req: { user } }, { operation: { operation } }],
    getArgByIndex: (i: number) =>
      [{}, {}, { req: { user } }, { operation: { operation } }][i],
  }) as unknown as ExecutionContext;

const complexAccount = {
  sub: COMPLEX_ID,
  entityType: 'complex',
  roles: [ValidRoles.COMPLEX_ROL],
};

describe('SubscriptionGuard', () => {
  it('bloquea las mutaciones de la administración con la suscripción suspendida', async () => {
    const { guard } = build({ endsAt: suspendedEndsAt });

    await expect(
      guard.canActivate(gqlContext(complexAccount, 'mutation')),
    ).rejects.toBeInstanceOf(CustomError);
  });

  it('el contador del conjunto también queda en solo lectura', async () => {
    const { guard } = build({ endsAt: suspendedEndsAt });
    const accountant = {
      sub: 'user-1',
      entityType: 'user',
      complexId: COMPLEX_ID,
      roles: [ValidRoles.ACCOUNTANT_ROL, ValidRoles.RESIDENT_ROL],
    };

    await expect(
      guard.canActivate(gqlContext(accountant, 'mutation')),
    ).rejects.toBeInstanceOf(CustomError);
  });

  it('deja consultar: suspendida es solo lectura, no sin acceso', async () => {
    const { guard } = build({ endsAt: suspendedEndsAt });

    await expect(
      guard.canActivate(gqlContext(complexAccount, 'query')),
    ).resolves.toBe(true);
  });

  it('nunca bloquea a residentes ni a portería', async () => {
    const { guard, findOne } = build({ endsAt: suspendedEndsAt });

    for (const role of [ValidRoles.RESIDENT_ROL, ValidRoles.SECURITY_ROL]) {
      await expect(
        guard.canActivate(
          gqlContext(
            { sub: 'u', complexId: COMPLEX_ID, roles: [role] },
            'mutation',
          ),
        ),
      ).resolves.toBe(true);
    }
    expect(findOne).not.toHaveBeenCalled();
  });

  it('deja pasar lo marcado con @AllowWhenSuspended (pánico, sesión, avisos)', async () => {
    const { guard } = build({ endsAt: suspendedEndsAt, allowed: true });

    await expect(
      guard.canActivate(gqlContext(complexAccount, 'mutation')),
    ).resolves.toBe(true);
  });

  it('el SUPER_ADMIN nunca se bloquea: es quien renueva', async () => {
    const { guard } = build({ endsAt: suspendedEndsAt });

    await expect(
      guard.canActivate(
        gqlContext(
          {
            sub: 'admin',
            complexId: COMPLEX_ID,
            roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL],
          },
          'mutation',
        ),
      ),
    ).resolves.toBe(true);
  });

  it('en la gracia todo sigue funcionando', async () => {
    const { guard } = build({ endsAt: graceEndsAt });

    await expect(
      guard.canActivate(gqlContext(complexAccount, 'mutation')),
    ).resolves.toBe(true);
  });

  it('sin suscripción registrada no se bloquea', async () => {
    const { guard } = build({ endsAt: null });

    await expect(
      guard.canActivate(gqlContext(complexAccount, 'mutation')),
    ).resolves.toBe(true);
  });

  it('falla abierta si no puede leer la suscripción', async () => {
    const { guard } = build({ dbFails: true });

    await expect(
      guard.canActivate(gqlContext(complexAccount, 'mutation')),
    ).resolves.toBe(true);
  });

  describe('suspensión manual del SUPER_ADMIN', () => {
    it('bloquea también las consultas de la administración y lleva el motivo', async () => {
      const { guard } = build({
        status: ComplexStatus.SUSPENDED,
        reason: 'Uso indebido de la plataforma',
      });

      const error = await guard
        .canActivate(gqlContext(complexAccount, 'query'))
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(CustomError);
      expect((error as CustomError).errorCode).toBe(
        AuthErrorCode.COMPLEX_SUSPENDED,
      );
      expect((error as CustomError).message).toContain(
        'Uso indebido de la plataforma',
      );
    });

    it('deja pasar lo marcado con @AllowWhenSuspended (sesión, motivo, pánico)', async () => {
      const { guard } = build({
        status: ComplexStatus.SUSPENDED,
        allowed: true,
      });

      await expect(
        guard.canActivate(gqlContext(complexAccount, 'query')),
      ).resolves.toBe(true);
    });

    it('no toca a residentes ni a portería', async () => {
      const { guard } = build({ status: ComplexStatus.SUSPENDED });

      for (const role of [ValidRoles.RESIDENT_ROL, ValidRoles.SECURITY_ROL]) {
        await expect(
          guard.canActivate(
            gqlContext(
              { sub: 'u', complexId: COMPLEX_ID, roles: [role] },
              'query',
            ),
          ),
        ).resolves.toBe(true);
      }
    });
  });
});

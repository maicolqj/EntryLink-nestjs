import { ExecutionContext } from '@nestjs/common';

import { ComplexModuleGuard } from './complex-module.guard';
import { ComplexModule } from '../../residential-complex/enums/complex-module.enum';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ComplexErrorCode } from '../constans/error-codes.constants';

/**
 * Lo que este guard tiene que sostener:
 *
 *   1. Apagar un módulo lo apaga DE VERDAD. Esconder la opción del menú es una
 *      comodidad; quien conserve un enlace viejo o llame la API directo entraba
 *      igual.
 *   2. Lista vacía = todos habilitados. Un conjunto que nunca tocó la
 *      configuración no puede quedarse sin plataforma.
 *   3. El SUPER_ADMIN nunca se bloquea: es quien mueve el interruptor, y
 *      dejarlo afuera lo dejaría sin poder volver a encenderlo.
 *   4. Si no se puede averiguar, se deja pasar. Que Redis o la base tosan no
 *      puede dejar sin paquetería a un conjunto que sí la tiene.
 */

const contextOf = (
  args: Record<string, unknown>,
  user: { roles?: string[]; complexId?: string } | undefined,
): ExecutionContext =>
  ({
    getHandler: () => () => undefined,
    getClass: () => class {},
    getType: () => 'graphql',
    getArgs: () => [undefined, args, { req: { user } }, undefined],
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

/**
 * `required` va como `null` —y no como `undefined`— para decir "sin módulo
 * exigido": con `undefined` el valor por defecto del parámetro lo repone y la
 * prueba terminaría midiendo lo contrario de lo que dice su nombre.
 */
const buildGuard = (
  modules: string[] | null,
  required: ComplexModule | null = ComplexModule.FINANZAS,
) => {
  const query = jest.fn(() =>
    modules === null
      ? Promise.reject(new Error('base caída'))
      : Promise.resolve([{ enabled_modules: modules.join(',') }]),
  );

  const cacheService = {
    get: jest.fn(() => Promise.resolve(null)),
    set: jest.fn(() => Promise.resolve(undefined)),
  };

  const guard = new ComplexModuleGuard(
    { getAllAndOverride: jest.fn(() => required ?? undefined) } as never,
    { query } as never,
    cacheService as never,
  );

  return { guard, query, cacheService };
};

const resident = { roles: [ValidRoles.RESIDENT_ROL], complexId: 'complex-1' };

describe('ComplexModuleGuard', () => {
  it('bloquea el módulo apagado aunque el cliente lo pida directo', async () => {
    const { guard } = buildGuard(['PAQUETES', 'VISITAS']);

    await expect(
      guard.canActivate(contextOf({ complexId: 'complex-1' }, resident)),
    ).rejects.toMatchObject({
      errorCode: ComplexErrorCode.COMPLEX_MODULE_DISABLED,
    });
  });

  it('deja pasar el módulo encendido', async () => {
    const { guard } = buildGuard(['FINANZAS', 'PAQUETES']);

    await expect(
      guard.canActivate(contextOf({ complexId: 'complex-1' }, resident)),
    ).resolves.toBe(true);
  });

  it('lista vacía = todos habilitados', async () => {
    const { guard } = buildGuard([]);

    await expect(
      guard.canActivate(contextOf({ complexId: 'complex-1' }, resident)),
    ).resolves.toBe(true);
  });

  it('el SUPER_ADMIN pasa: es quien mueve el interruptor', async () => {
    const { guard, query } = buildGuard(['PAQUETES']);

    await expect(
      guard.canActivate(
        contextOf(
          { complexId: 'complex-1' },
          { roles: [ValidRoles.SUPER_ADMIN_ROL] },
        ),
      ),
    ).resolves.toBe(true);
    // Ni siquiera consulta: se corta antes.
    expect(query).not.toHaveBeenCalled();
  });

  it('sin módulo exigido no se mete: la operación no es de un módulo apagable', async () => {
    const { guard, query } = buildGuard(['PAQUETES'], null);

    await expect(
      guard.canActivate(contextOf({ complexId: 'complex-1' }, resident)),
    ).resolves.toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  it('si la consulta falla, deja pasar', async () => {
    const { guard } = buildGuard(null);

    await expect(
      guard.canActivate(contextOf({ complexId: 'complex-1' }, resident)),
    ).resolves.toBe(true);
  });

  /**
   * El argumento manda sobre el token: el supervisor trabaja sobre complejos
   * que no son el suyo, y validar contra el del JWT dejaría pasar lo que se
   * pidió sobre otro.
   */
  it('valida el complejo del argumento, no el del token', async () => {
    const { guard, query } = buildGuard(['PAQUETES']);

    await expect(
      guard.canActivate(
        contextOf(
          { complexId: 'complex-2' },
          { roles: [ValidRoles.SUPERVISOR_ROL], complexId: 'complex-1' },
        ),
      ),
    ).rejects.toMatchObject({
      errorCode: ComplexErrorCode.COMPLEX_MODULE_DISABLED,
    });

    expect(query).toHaveBeenCalledWith(expect.any(String), ['complex-2']);
  });

  it('cuando el complexId viaja dentro del input, también lo encuentra', async () => {
    const { guard, query } = buildGuard(['PAQUETES']);

    await expect(
      guard.canActivate(
        contextOf({ input: { complexId: 'complex-3' } }, resident),
      ),
    ).rejects.toMatchObject({
      errorCode: ComplexErrorCode.COMPLEX_MODULE_DISABLED,
    });

    expect(query).toHaveBeenCalledWith(expect.any(String), ['complex-3']);
  });
});

describe('ComplexModuleGuard — orden de los guards', () => {
  /**
   * Va sobre la clase, así que Nest lo corre ANTES del `@Auth` del método. Si
   * contestara "módulo apagado" a alguien sin token, le estaría contando a
   * cualquiera qué tiene contratado el conjunto.
   */
  it('sin sesión no opina: deja que conteste el guard de autenticación', async () => {
    const { guard, query } = buildGuard(['PAQUETES']);

    await expect(
      guard.canActivate(contextOf({ complexId: 'complex-1' }, undefined)),
    ).resolves.toBe(true);

    expect(query).not.toHaveBeenCalled();
  });
});

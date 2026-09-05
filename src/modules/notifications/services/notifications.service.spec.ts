import { NotificationsService } from './notifications.service';
import { ValidRoles } from '../../roles/enums/valid-roles';

/**
 * Spec de a QUIÉN se le avisa.
 *
 * La cuenta del complejo no es una fila de `users`: inicia sesión contra
 * `residential_complexes` y su `sub` es el id del complejo. Una consulta sobre
 * usuarios nunca la encuentra, así que pedir COMPLEX_ROL devolvía una lista
 * vacía y el aviso a la administración se perdía en silencio —quien notifica
 * corta cuando no hay destinatarios—.
 */

const COMPLEX_ID = 'complex-1';

/** QueryBuilder falso: solo importa qué usuarios devuelve la consulta. */
let lastQb: any;

const build = (rows: { userId: string }[]): NotificationsService => {
  const qb = {
    innerJoin:  jest.fn().mockReturnThis(),
    where:      jest.fn().mockReturnThis(),
    andWhere:   jest.fn().mockReturnThis(),
    select:     jest.fn().mockReturnThis(),
    distinct:   jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(rows),
  };

  lastQb = qb;
  const userRoleRepo = { createQueryBuilder: jest.fn(() => qb) };

  return new NotificationsService(
    null as never, null as never, null as never, null as never, null as never,
    null as never, null as never, null as never,
    null as never,              // userRepo
    userRoleRepo as never,      // userRoleRepo
    null as never, null as never, null as never, null as never,
  );
};

describe('NotificationsService — destinatarios por rol', () => {

  it('incluye la cuenta del complejo cuando se pide COMPLEX_ROL', async () => {
    // En una copropiedad recién montada no hay ningún `user` con COMPLEX_ROL:
    // la administración entra con la cuenta del complejo.
    const service = build([]);

    const ids = await service.findUserIdsByRoles(COMPLEX_ID, [ValidRoles.COMPLEX_ROL]);

    expect(ids).toEqual([COMPLEX_ID]);
  });

  it('suma la cuenta del complejo a los usuarios que sí resuelven', async () => {
    const service = build([{ userId: 'supervisor-1' }]);

    const ids = await service.findUserIdsByRoles(COMPLEX_ID, [
      ValidRoles.COMPLEX_ROL, ValidRoles.SUPERVISOR_ROL,
    ]);

    expect(ids).toEqual(['supervisor-1', COMPLEX_ID]);
  });

  it('no la agrega cuando no se pide COMPLEX_ROL', async () => {
    const service = build([{ userId: 'guard-1' }]);

    const ids = await service.findUserIdsByRoles(COMPLEX_ID, [ValidRoles.SECURITY_ROL]);

    expect(ids).toEqual(['guard-1']);
  });

  it('busca al personal por su asignación al complejo, no solo por users.complex_id', async () => {
    // Un supervisor puede atender varios complejos: su vínculo vive en
    // `user_complex_assignments`, y mirar solo la columna lo dejaba fuera.
    const service = build([]);

    await service.findUserIdsByRoles(COMPLEX_ID, [ValidRoles.SUPERVISOR_ROL]);

    const clause = lastQb.where.mock.calls[0][0] as string;
    expect(clause).toContain('user_complex_assignments');
    expect(clause).toContain('u.complex_id = :complexId');
  });

  it('no la duplica si la consulta ya la devolvió', async () => {
    const service = build([{ userId: COMPLEX_ID }]);

    const ids = await service.findUserIdsByRoles(COMPLEX_ID, [ValidRoles.COMPLEX_ROL]);

    expect(ids).toEqual([COMPLEX_ID]);
  });
});

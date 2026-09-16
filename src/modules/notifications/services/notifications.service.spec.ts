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
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    distinct: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(rows),
  };

  lastQb = qb;
  const userRoleRepo = { createQueryBuilder: jest.fn(() => qb) };

  return new NotificationsService(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null,
    null as never,
    null as never, // userRepo
    userRoleRepo as never, // userRoleRepo
    null as never,
    null as never,
    null as never,
    null,
    null,
    null as never, // snapshotService: no interviene en los destinatarios
  );
};

describe('NotificationsService — destinatarios por rol', () => {
  it('incluye la cuenta del complejo cuando se pide COMPLEX_ROL', async () => {
    // En una copropiedad recién montada no hay ningún `user` con COMPLEX_ROL:
    // la administración entra con la cuenta del complejo.
    const service = build([]);

    const ids = await service.findUserIdsByRoles(COMPLEX_ID, [
      ValidRoles.COMPLEX_ROL,
    ]);

    expect(ids).toEqual([COMPLEX_ID]);
  });

  it('suma la cuenta del complejo a los usuarios que sí resuelven', async () => {
    const service = build([{ userId: 'supervisor-1' }]);

    const ids = await service.findUserIdsByRoles(COMPLEX_ID, [
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
    ]);

    expect(ids).toEqual(['supervisor-1', COMPLEX_ID]);
  });

  it('no la agrega cuando no se pide COMPLEX_ROL', async () => {
    const service = build([{ userId: 'guard-1' }]);

    const ids = await service.findUserIdsByRoles(COMPLEX_ID, [
      ValidRoles.SECURITY_ROL,
    ]);

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

    const ids = await service.findUserIdsByRoles(COMPLEX_ID, [
      ValidRoles.COMPLEX_ROL,
    ]);

    expect(ids).toEqual([COMPLEX_ID]);
  });
});

/**
 * Destacar es del DESTINATARIO, no del sistema.
 *
 * La prioridad la fija el módulo que emite el aviso; la estrella la pone quien
 * lo recibe sobre lo que tiene pendiente. Lo que estos specs sostienen es la
 * única frontera que no se puede cruzar: un broadcast es UNA fila compartida
 * por todo el complejo, así que destacarla se la destacaría a todos.
 */
describe('NotificationsService — destacar un aviso', () => {
  const user = {
    sub: 'user-1',
    roles: [ValidRoles.COMPLEX_ROL],
    complexId: COMPLEX_ID,
  } as never;

  const buildWith = (notif: Record<string, unknown>) => {
    const save = jest.fn((n: unknown) => Promise.resolve(n));
    const notifRepo = {
      findOne: jest.fn(() => Promise.resolve(notif)),
      save,
    };

    const service = new NotificationsService(
      notifRepo as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null,
      null,
      null as never,
    );

    return { service, save };
  };

  it('marca la notificación propia', async () => {
    const h = buildWith({
      id: '11111111-1111-4111-8111-111111111111',
      recipientUserId: 'user-1',
      complexId: COMPLEX_ID,
      isBroadcast: false,
      isStarred: false,
    });

    const result = await h.service.setStarred('11111111-1111-4111-8111-111111111111', true, user);

    expect(result.isStarred).toBe(true);
    expect(h.save).toHaveBeenCalledTimes(1);
  });

  it('no escribe cuando ya estaba en ese estado', async () => {
    const h = buildWith({
      id: '11111111-1111-4111-8111-111111111111',
      recipientUserId: 'user-1',
      complexId: COMPLEX_ID,
      isBroadcast: false,
      isStarred: true,
    });

    await h.service.setStarred('11111111-1111-4111-8111-111111111111', true, user);

    expect(h.save).not.toHaveBeenCalled();
  });

  it('rechaza destacar un aviso masivo: la fila es de todos', async () => {
    const h = buildWith({
      id: '11111111-1111-4111-8111-111111111111',
      recipientUserId: null,
      complexId: COMPLEX_ID,
      isBroadcast: true,
      isStarred: false,
    });

    await expect(h.service.setStarred('11111111-1111-4111-8111-111111111111', true, user)).rejects.toBeDefined();
    expect(h.save).not.toHaveBeenCalled();
  });
});

/**
 * Acciones en lote de la bandeja.
 *
 * Lo que no puede cambiar: el alcance. Seleccionar veinte avisos y pulsar
 * "eliminar" tiene que tocar SOLO las filas de quien lo pulsa —nunca las de
 * otro destinatario ni un comunicado, que es una fila compartida por todo el
 * complejo—, y eso se decide en el WHERE, no en la pantalla.
 */
describe('NotificationsService — acciones en lote', () => {
  const ID_A = '11111111-1111-4111-8111-111111111111';
  const ID_B = '22222222-2222-4222-8222-222222222222';

  const user = {
    sub: 'user-1',
    roles: [ValidRoles.COMPLEX_ROL],
    complexId: COMPLEX_ID,
  } as never;

  const buildBulk = (affected: number) => {
    const where = jest.fn().mockReturnThis();
    const execute = jest.fn().mockResolvedValue({ affected });
    const qb = {
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where,
      execute,
    };

    const service = new NotificationsService(
      { createQueryBuilder: jest.fn(() => qb) } as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null,
      null,
      null as never,
    );

    return { service, qb, where };
  };

  it('acota siempre a las filas propias y deja fuera los masivos', async () => {
    const h = buildBulk(2);

    await h.service.bulkAction(
      { notificationIds: [ID_A, ID_B], action: 'MARK_READ' as never },
      user,
    );

    const [condition, params] = h.where.mock.calls[0];
    expect(condition).toContain('"recipientUserId" = :userId');
    expect(condition).toContain('"isBroadcast" = false');
    expect(params).toMatchObject({ userId: 'user-1' });
  });

  it('reporta como omitidas las que no pudo tocar en vez de fallar', async () => {
    // Dos pedidas, una era un comunicado: la acción no se cae por eso.
    const h = buildBulk(1);

    const result = await h.service.bulkAction(
      { notificationIds: [ID_A, ID_B], action: 'DELETE' as never },
      user,
    );

    expect(result).toEqual({ affected: 1, skipped: 1 });
  });

  it('no consulta la base cuando ningún id es válido', async () => {
    const h = buildBulk(0);

    const result = await h.service.bulkAction(
      { notificationIds: ['no-es-uuid'], action: 'STAR' as never },
      user,
    );

    expect(result).toEqual({ affected: 0, skipped: 1 });
    expect(h.qb.execute).not.toHaveBeenCalled();
  });
});

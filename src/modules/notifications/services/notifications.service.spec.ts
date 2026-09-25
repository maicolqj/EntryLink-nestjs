import { NotificationsService } from './notifications.service';
import { NotificationChannel } from '../enums/notification-channel.enum';
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

    const result = await h.service.setStarred(
      '11111111-1111-4111-8111-111111111111',
      true,
      user,
    );

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

    await h.service.setStarred(
      '11111111-1111-4111-8111-111111111111',
      true,
      user,
    );

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

    await expect(
      h.service.setStarred('11111111-1111-4111-8111-111111111111', true, user),
    ).rejects.toBeDefined();
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

/**
 * Spec de QUÉ ve cada sombrero.
 *
 * La bandeja se direcciona por `recipientUserId`, así que devuelve todo lo
 * dirigido a una persona sin importar desde dónde mire. Quien administra y
 * además vive en el conjunto entra a la app con una sesión acotada a residente,
 * y ahí no puede aparecerle la operación del conjunto.
 */
describe('NotificationsService — audiencia de la bandeja', () => {
  /** Captura los `andWhere` para ver si se aplicó el recorte por tipo. */
  const buildQb = () => {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};
    const qb: any = {
      where: jest.fn(() => qb),
      andWhere: jest.fn((sql: string, p?: Record<string, unknown>) => {
        conditions.push(sql);
        Object.assign(params, p ?? {});
        return qb;
      }),
      orderBy: jest.fn(() => qb),
      skip: jest.fn(() => qb),
      take: jest.fn(() => qb),
      getCount: jest.fn(async () => 0),
      getMany: jest.fn(async () => []),
    };
    return { qb, conditions, params };
  };

  const buildService = (qb: any) =>
    new NotificationsService(
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

  const pagination = { page: 1, limit: 20 };

  it('la sesión de residente solo ve los tipos de su audiencia', async () => {
    const { qb, conditions, params } = buildQb();

    await buildService(qb).findByUser(COMPLEX_ID, pagination, {}, {
      sub: 'user-1',
      roles: [ValidRoles.RESIDENT_ROL],
      complexId: COMPLEX_ID,
    } as never);

    expect(conditions).toContain('n.type IN (:...audienceTypes)');
    const tipos = params.audienceTypes as string[];
    // Lo de la unidad entra; la operación del conjunto no.
    expect(tipos).toContain('PACKAGE_RECEIVED');
    expect(tipos).toContain('PANIC_ALERT');
    expect(tipos).not.toContain('PET_INCIDENT_REPORTED');
    expect(tipos).not.toContain('RESIDENT_PENDING');
  });

  it('el consejero sigue siendo una sesión de residente', async () => {
    const { qb, conditions } = buildQb();

    await buildService(qb).findByUser(COMPLEX_ID, pagination, {}, {
      sub: 'user-1',
      roles: [ValidRoles.RESIDENT_ROL, ValidRoles.COUNCIL_ROL],
      complexId: COMPLEX_ID,
    } as never);

    expect(conditions).toContain('n.type IN (:...audienceTypes)');
  });

  it('una sesión con cargo no se recorta', async () => {
    const { qb, conditions } = buildQb();

    await buildService(qb).findByUser(COMPLEX_ID, pagination, {}, {
      sub: 'user-1',
      roles: [ValidRoles.COMPLEX_ROL],
      complexId: COMPLEX_ID,
    } as never);

    expect(conditions).not.toContain('n.type IN (:...audienceTypes)');
  });

  it('la misma cuenta con los dos sombreros ve todo con el token completo', async () => {
    // Entrar por correo y contraseña emite el token con todos los roles: ahí sí
    // corresponde ver la operación del conjunto.
    const { qb, conditions } = buildQb();

    await buildService(qb).findByUser(COMPLEX_ID, pagination, {}, {
      sub: 'user-1',
      roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.RESIDENT_ROL],
      complexId: COMPLEX_ID,
    } as never);

    expect(conditions).not.toContain('n.type IN (:...audienceTypes)');
  });

  it('el badge cuenta lo mismo que la bandeja muestra', async () => {
    const { qb, conditions } = buildQb();

    await buildService(qb).getUnreadCount(COMPLEX_ID, {
      sub: 'user-1',
      roles: [ValidRoles.RESIDENT_ROL],
      complexId: COMPLEX_ID,
    } as never);

    expect(conditions).toContain('n.type IN (:...audienceTypes)');
  });

  describe('canal panel', () => {
    const superAdminResidente = {
      sub: 'user-1',
      roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.RESIDENT_ROL],
      complexId: null,
    } as never;

    it('el panel deja fuera los avisos de la unidad de quien administra', async () => {
      // El super admin que vive en un conjunto recibía en el panel el paquete
      // de su apartamento mezclado con los avisos del sistema.
      const { qb, conditions, params } = buildQb();

      await buildService(qb).findByUser(
        null,
        pagination,
        {},
        superAdminResidente,
        NotificationChannel.PANEL,
      );

      expect(conditions).toContain('n.type IN (:...panelTypes)');
      const tipos = params.panelTypes as string[];
      expect(tipos).toContain('DPA_SIGNED');
      expect(tipos).toContain('PANIC_ALERT');
      expect(tipos).not.toContain('PACKAGE_RECEIVED');
      expect(tipos).not.toContain('PAYMENT_DUE');
    });

    it('el badge del panel cuenta lo mismo que su bandeja', async () => {
      const { qb, conditions } = buildQb();

      await buildService(qb).getUnreadCount(
        null,
        superAdminResidente,
        NotificationChannel.PANEL,
      );

      expect(conditions).toContain('n.type IN (:...panelTypes)');
    });

    it('sin canal la app no cambia', async () => {
      const { qb, conditions } = buildQb();

      await buildService(qb).findByUser(null, pagination, {}, superAdminResidente);

      expect(conditions).not.toContain('n.type IN (:...panelTypes)');
    });
  });
});

describe('NotificationsService — el pánico y el super admin', () => {
  const buildPush = (superAdminIds: string[]) => {
    const qb = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(superAdminIds.map((userId) => ({ userId }))),
    };
    const pushSubRepo = { find: jest.fn(async () => []) };
    const service = new NotificationsService(
      null as never,
      pushSubRepo as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null,
      null as never,
      null as never,
      { createQueryBuilder: jest.fn(() => qb) } as never,
      null as never,
      null as never,
      null as never,
      null,
      null,
      null as never,
    );
    return { service, pushSubRepo };
  };

  const panic = (userIds: string[]) => ({
    complexId: COMPLEX_ID,
    userIds,
    type: 'PANIC_ALERT',
    priority: 'URGENT',
    title: 'Pánico',
    body: 'Alerta',
  }) as never;

  // El query builder falso devuelve a quienes la consulta excluye: los
  // SUPER_ADMIN_ROL SIN rol de residente. Un super admin que además es residente
  // vive en un conjunto y la alarma de donde vive sí le llega.
  it('el re-push de un pánico salta al super admin que no es residente', async () => {
    const h = buildPush(['super-1']);

    await h.service.dispatchPushOnly(['guard-1', 'super-1'], panic(['guard-1', 'super-1']));

    const where = (h.pushSubRepo.find.mock.calls[0] as any)[0].where;
    expect(where.userId.value).toEqual(['guard-1']);
  });

  it('si solo quedaba el super admin, no se envía nada', async () => {
    const h = buildPush(['super-1']);

    await h.service.dispatchPushOnly(['super-1'], panic(['super-1']));

    expect(h.pushSubRepo.find).not.toHaveBeenCalled();
  });

  it('otros avisos no se filtran', async () => {
    const h = buildPush(['super-1']);

    await h.service.dispatchPushOnly(['super-1'], {
      complexId: COMPLEX_ID,
      userIds: ['super-1'],
      type: 'LOGIN_APPROVAL_REQUEST',
      priority: 'HIGH',
      title: 't',
      body: 'b',
    } as never);

    expect(h.pushSubRepo.find).toHaveBeenCalled();
  });
});

describe('NotificationsService — pánicos activos por sesión', () => {
  const buildActive = () => {
    const find = jest.fn(async () => [{ id: 'panic-1' }]);
    const service = new NotificationsService(
      { find } as never,
      null as never, null as never, null as never, null as never, null as never,
      null, null as never, null as never, null as never, null as never,
      null as never, null as never, null, null, null as never,
    );
    return { service, find };
  };

  it('el panel del super admin no recibe pánicos', async () => {
    const h = buildActive();
    const result = await h.service.activePanicAlerts(COMPLEX_ID, {
      sub: 'super-1',
      roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.RESIDENT_ROL],
    } as never);
    expect(result).toEqual([]);
    expect(h.find).not.toHaveBeenCalled();
  });

  it('la sesión de residente del mismo usuario sí los recibe', async () => {
    const h = buildActive();
    const result = await h.service.activePanicAlerts(COMPLEX_ID, {
      sub: 'super-1',
      roles: [ValidRoles.RESIDENT_ROL],
    } as never);
    expect(result).toHaveLength(1);
  });
});

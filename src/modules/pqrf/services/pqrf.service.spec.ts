import { PqrfService } from './pqrf.service';
import { Pqrf } from '../entities/pqrf.entity';
import { PqrfType } from '../enums/pqrf-type.enum';
import { PqrfStatus } from '../enums/pqrf-status.enum';
import { PqrfAddressee } from '../enums/pqrf-addressee.enum';

import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

/**
 * Specs de QUIÉN puede leer un radicado.
 *
 * Es la regla que sostiene el módulo: un residente solo puede quejarse del
 * administrador si el radicado dirigido al consejo no le llega al administrador.
 * Si esto se rompe, el módulo deja de servir para lo que existe.
 */

const userOf = (roles: ValidRoles[], sub = 'user-1'): JwtAccessPayload => ({
  sub, email: 'quien@test.com', type: 'access', entityType: 'user',
  tokenVersion: 1, sessionId: 's1', roles, permissions: [], complexId: 'complex-1',
} as JwtAccessPayload);

const pqrfOf = (partial: Partial<Pqrf> = {}): Pqrf => ({
  id: 'pqrf-1',
  code: 'PQRF-000001',
  consecutive: 1,
  complexId: 'complex-1',
  type: PqrfType.QUEJA,
  addressee: PqrfAddressee.CONSEJO,
  status: PqrfStatus.RADICADO,
  subject: 'Queja sobre la administración',
  description: 'El administrador no responde los correos.',
  requestedByUserId: 'resident-user',
  ...partial,
} as Pqrf);

interface Harness {
  service: PqrfService;
  /** Condiciones que la consulta acumuló: es donde vive el filtro por destinatario. */
  conditions: { sql: string; params?: Record<string, unknown> }[];
  saved: Pqrf[];
  acks: { save: jest.Mock; find: jest.Mock; findOne: jest.Mock };
  notify: jest.Mock;
  pqrfRepo: { find: jest.Mock; findOne: jest.Mock; save: jest.Mock };
}

interface BuildOpts {
  /** Quiénes deben marcar el radicado como resuelto. */
  adminIds?: string[];
  councilIds?: string[];
  /** Huellas ya existentes: `resolvedAt` marca a quien ya lo dio por resuelto. */
  acks?: { userId: string; instance: PqrfAddressee; resolvedAt?: Date | null }[];
  /** Consejeros que la administración designó para responder. Vacío = todos. */
  designated?: string[];
}

const build = (pqrf: Pqrf | null, isCouncilUser = false, opts: BuildOpts = {}): Harness => {
  const conditions: { sql: string; params?: Record<string, unknown> }[] = [];

  const qb: Record<string, unknown> = {};
  Object.assign(qb, {
    where:    jest.fn(() => qb),
    andWhere: jest.fn((sql: string, params?: Record<string, unknown>) => {
      conditions.push({ sql, params });
      return qb;
    }),
    leftJoinAndSelect: jest.fn(() => qb),
    orderBy:  jest.fn(() => qb),
    skip:     jest.fn(() => qb),
    take:     jest.fn(() => qb),
    getCount: jest.fn().mockResolvedValue(0),
    getMany:  jest.fn().mockResolvedValue([]),
  });

  const saved: Pqrf[] = [];

  const pqrfRepo = {
    createQueryBuilder: jest.fn(() => qb),
    findOne: jest.fn().mockResolvedValue(pqrf),
    find:    jest.fn().mockResolvedValue([]),
    save:    jest.fn(async (row: Pqrf) => { saved.push(row); return row; }),
  };

  const ackRepo = {
    findOne: jest.fn().mockResolvedValue(
      (opts.acks ?? []).find(a => a.userId === 'self') ?? null,
    ),
    find:    jest.fn().mockResolvedValue(opts.acks ?? []),
    count:   jest.fn().mockResolvedValue((opts.acks ?? []).length),
    create:  jest.fn((row: unknown) => row),
    save:    jest.fn(async (row: unknown) => row),
  };

  const notify = jest.fn();

  const service = new PqrfService(
    pqrfRepo as never,
    ackRepo as never,
    { findById: jest.fn().mockResolvedValue({ id: 'complex-1' }) } as never,
    {
      findMyProfile: jest.fn(),
      isCouncilUser: jest.fn().mockResolvedValue(isCouncilUser),
      findCouncilUserIds: jest.fn().mockResolvedValue(opts.councilIds ?? []),
    } as never,
    { notify, findUserIdsByRoles: jest.fn().mockResolvedValue(opts.adminIds ?? []) } as never,
    { log: jest.fn() } as never,
    { transaction: jest.fn() } as never,
    { emitToComplex: jest.fn(), emitToUser: jest.fn() } as never,
    { findOne: jest.fn().mockResolvedValue({ pqrfCouncilResolverUserIds: opts.designated ?? [] }) } as never,
  );

  return { service, conditions, saved, acks: ackRepo as never, notify, pqrfRepo };
};

const PAGE = { page: 1, limit: 20 };

describe('PqrfService — quién puede leer un radicado', () => {

  describe('ficha del radicado', () => {
    it('la administración NO alcanza uno dirigido solo al consejo', async () => {
      const { service } = build(pqrfOf({ addressee: PqrfAddressee.CONSEJO }));

      await expect(
        service.findById('pqrf-1', userOf([ValidRoles.COMPLEX_ROL], 'admin-user')),
      ).rejects.toThrow('Este radicado no está dirigido a ti');
    });

    it('el consejero sí lo alcanza', async () => {
      const { service } = build(pqrfOf({ addressee: PqrfAddressee.CONSEJO }), true);

      const found = await service.findById(
        'pqrf-1', userOf([ValidRoles.RESIDENT_ROL, ValidRoles.COUNCIL_ROL], 'council-user'),
      );

      expect(found.code).toBe('PQRF-000001');
    });

    it('la administración alcanza el dirigido a ambos', async () => {
      const { service } = build(pqrfOf({ addressee: PqrfAddressee.AMBOS }));

      const found = await service.findById('pqrf-1', userOf([ValidRoles.COMPLEX_ROL], 'admin-user'));

      expect(found.id).toBe('pqrf-1');
    });

    it('quien lo radicó siempre lo puede leer, aunque no sea el destinatario', async () => {
      const { service } = build(pqrfOf({ addressee: PqrfAddressee.CONSEJO }));

      const found = await service.findById('pqrf-1', userOf([ValidRoles.RESIDENT_ROL], 'resident-user'));

      expect(found.id).toBe('pqrf-1');
    });
  });

  describe('bandeja', () => {
    it('a la administración solo le consulta lo dirigido a ella o a ambos', async () => {
      const { service, conditions } = build(null);

      await service.findByComplex('complex-1', PAGE, {}, userOf([ValidRoles.COMPLEX_ROL], 'admin-user'));

      const scope = conditions.find(c => c.sql.includes('addressee IN'));
      expect(scope?.params?.visible).toEqual([
        PqrfAddressee.ADMINISTRACION, PqrfAddressee.AMBOS,
      ]);
    });

    it('al consejo solo le consulta lo dirigido al consejo o a ambos', async () => {
      const { service, conditions } = build(null, true);

      await service.findByComplex(
        'complex-1', PAGE, {}, userOf([ValidRoles.RESIDENT_ROL, ValidRoles.COUNCIL_ROL], 'council-user'),
      );

      const scope = conditions.find(c => c.sql.includes('addressee IN'));
      expect(scope?.params?.visible).toEqual([PqrfAddressee.CONSEJO, PqrfAddressee.AMBOS]);
    });

    it('un residente cualquiera no tiene bandeja', async () => {
      const { service } = build(null);

      await expect(
        service.findByComplex('complex-1', PAGE, {}, userOf([ValidRoles.RESIDENT_ROL], 'otro')),
      ).rejects.toThrow('No tienes acceso a los radicados del complejo');
    });

    it('el filtro por destinatario no saca a nadie de su alcance', async () => {
      // Pedir "CONSEJO" desde la administración deja las dos condiciones: la del
      // alcance y la del filtro, que juntas no devuelven nada ajeno.
      const { service, conditions } = build(null);

      await service.findByComplex(
        'complex-1', PAGE, { addressee: PqrfAddressee.CONSEJO },
        userOf([ValidRoles.COMPLEX_ROL], 'admin-user'),
      );

      expect(conditions.find(c => c.sql.includes('addressee IN'))?.params?.visible).toEqual([
        PqrfAddressee.ADMINISTRACION, PqrfAddressee.AMBOS,
      ]);
      expect(conditions.some(c => c.sql === 'p.addressee = :addressee')).toBe(true);
    });
  });
});

describe('PqrfService — seguimiento del radicado', () => {

  const admin = () => userOf([ValidRoles.COMPLEX_ROL], 'admin-user');

  it('abrir la ficha pasa el radicado a EN TRÁMITE', async () => {
    const { service, saved, acks } = build(
      pqrfOf({ addressee: PqrfAddressee.ADMINISTRACION, status: PqrfStatus.RADICADO }),
    );

    await service.open('pqrf-1', admin());

    expect(acks.save).toHaveBeenCalled();
    expect(saved[saved.length - 1].status).toBe(PqrfStatus.EN_TRAMITE);
  });

  it('que lo abra quien lo radicó no cuenta como atendido', async () => {
    const { service, saved, acks } = build(
      pqrfOf({ addressee: PqrfAddressee.ADMINISTRACION, requestedByUserId: 'resident-user' }),
    );

    await service.open('pqrf-1', userOf([ValidRoles.RESIDENT_ROL], 'resident-user'));

    expect(acks.save).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  it('con dos destinatarios, uno solo no lo da por resuelto', async () => {
    // El radicado fue a ambas instancias: administración y un consejero.
    const { service, saved, notify } = build(
      pqrfOf({ addressee: PqrfAddressee.AMBOS, status: PqrfStatus.EN_TRAMITE }),
      false,
      { adminIds: ['admin-user'], councilIds: ['council-user'] },
    );

    const result = await service.markResolved('pqrf-1', admin());

    expect(result.status).not.toBe(PqrfStatus.RESUELTO);
    expect(saved.some(p => p.status === PqrfStatus.RESUELTO)).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it('cuando el último marca, queda RESUELTO y se le avisa al residente', async () => {
    // El consejero ya lo había marcado; falta la administración.
    const { service, saved, notify } = build(
      pqrfOf({ addressee: PqrfAddressee.AMBOS, status: PqrfStatus.EN_TRAMITE }),
      false,
      {
        adminIds: ['admin-user'],
        councilIds: ['council-user'],
        acks: [
          { userId: 'council-user', instance: PqrfAddressee.CONSEJO,        resolvedAt: new Date() },
          { userId: 'admin-user',   instance: PqrfAddressee.ADMINISTRACION, resolvedAt: new Date() },
        ],
      },
    );

    await service.markResolved('pqrf-1', admin());

    expect(saved.some(p => p.status === PqrfStatus.RESUELTO)).toBe(true);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ['resident-user'],
        body: expect.stringContaining('correo'),
      }),
    );
  });

  it('una sola persona de la administración cierra esa instancia', async () => {
    // La administración es una oficina: los supervisores que no lo tocaron no
    // pueden dejar el radicado abierto para siempre.
    const { service, saved, notify } = build(
      pqrfOf({ addressee: PqrfAddressee.AMBOS, status: PqrfStatus.EN_TRAMITE }),
      false,
      {
        adminIds: ['admin-user', 'supervisor-1', 'supervisor-2'],
        councilIds: ['council-user'],
        acks: [
          { userId: 'council-user', instance: PqrfAddressee.CONSEJO,        resolvedAt: new Date() },
          { userId: 'admin-user',   instance: PqrfAddressee.ADMINISTRACION, resolvedAt: new Date() },
        ],
      },
    );

    await service.markResolved('pqrf-1', admin());

    expect(saved.some(p => p.status === PqrfStatus.RESUELTO)).toBe(true);
    expect(notify).toHaveBeenCalled();
  });

  it('quien no atiende el radicado no lo puede resolver', async () => {
    const { service } = build(pqrfOf({ addressee: PqrfAddressee.CONSEJO }));

    await expect(
      service.markResolved('pqrf-1', userOf([ValidRoles.RESIDENT_ROL], 'resident-user')),
    ).rejects.toThrow('Solo quien atiende el radicado puede marcarlo como resuelto');
  });
});

describe('PqrfService — plazo y silencio administrativo', () => {

  /** Un radicado al que ya se le pasó la fecha límite. */
  const overdue = () => pqrfOf({
    addressee: PqrfAddressee.ADMINISTRACION,
    status: PqrfStatus.EN_TRAMITE,
    dueAt: new Date(Date.now() - 60 * 60 * 1000),
  });

  it('vencido y sin respuesta queda resuelto a favor del residente', async () => {
    const { service, saved, notify, pqrfRepo } = build(null);
    pqrfRepo.find.mockResolvedValue([overdue()]);

    const closed = await service.resolveExpiredBySilence();

    expect(closed).toBe(1);
    const result = saved[saved.length - 1];
    expect(result.status).toBe(PqrfStatus.RESUELTO);
    // Se marca aparte: no es lo mismo que le hayan respondido.
    expect(result.resolvedBySilence).toBe(true);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ['resident-user'],
        body: expect.stringContaining('silencio administrativo positivo'),
      }),
    );
  });

  it('no toca los radicados que todavía están en plazo', async () => {
    const { service, saved, pqrfRepo } = build(null);
    pqrfRepo.find.mockResolvedValue([]);

    const closed = await service.resolveExpiredBySilence();

    expect(closed).toBe(0);
    expect(saved).toHaveLength(0);
  });

  it('recuerda solo dentro de la ventana previa configurada', async () => {
    // Faltan 10 días y la ventana de recordatorios son 3: todavía no molesta.
    const { service, notify, pqrfRepo } = build(null);
    pqrfRepo.find.mockResolvedValue([pqrfOf({
      addressee: PqrfAddressee.ADMINISTRACION,
      status: PqrfStatus.EN_TRAMITE,
      dueAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      complex: { pqrfReminderLeadDays: 3, pqrfReminderIntervalHours: 24 },
    } as never)]);

    const sent = await service.sendDueReminders();

    expect(sent).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('insiste cuando el vencimiento ya está cerca', async () => {
    // Falta un día y la ventana son 3: toca recordar.
    const { service, notify, pqrfRepo } = build(null, false, { adminIds: ['admin-user'] });
    pqrfRepo.find.mockResolvedValue([pqrfOf({
      addressee: PqrfAddressee.ADMINISTRACION,
      status: PqrfStatus.EN_TRAMITE,
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      complex: { pqrfReminderLeadDays: 3, pqrfReminderIntervalHours: 24 },
    } as never)]);

    const sent = await service.sendDueReminders();

    expect(sent).toBe(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['admin-user'] }),
    );
  });

  it('respeta el intervalo entre recordatorios', async () => {
    // Se recordó hace una hora y el intervalo es de 24: no se vuelve a insistir.
    const { service, notify, pqrfRepo } = build(null, false, { adminIds: ['admin-user'] });
    pqrfRepo.find.mockResolvedValue([pqrfOf({
      addressee: PqrfAddressee.ADMINISTRACION,
      status: PqrfStatus.EN_TRAMITE,
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      lastReminderAt: new Date(Date.now() - 60 * 60 * 1000),
      complex: { pqrfReminderLeadDays: 3, pqrfReminderIntervalHours: 24 },
    } as never)]);

    const sent = await service.sendDueReminders();

    expect(sent).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('PqrfService — consejeros designados para responder', () => {

  const councilor = (sub: string) => userOf([ValidRoles.RESIDENT_ROL, ValidRoles.COUNCIL_ROL], sub);
  const forCouncil = () => pqrfOf({ addressee: PqrfAddressee.CONSEJO, status: PqrfStatus.EN_TRAMITE });

  it('un consejero no designado lo lee pero no lo puede resolver', async () => {
    const { service } = build(forCouncil(), true, {
      councilIds: ['c-1', 'c-2', 'c-3'], designated: ['c-1'],
    });

    await expect(service.findById('pqrf-1', councilor('c-2'))).resolves.toBeDefined();
    await expect(service.markResolved('pqrf-1', councilor('c-2')))
      .rejects.toThrow('Solo quien atiende el radicado puede marcarlo como resuelto');
    await expect(service.isCouncilObserver(forCouncil(), councilor('c-2'))).resolves.toBe(true);
  });

  it('basta con que respondan los designados para cerrarlo', async () => {
    const { service, saved } = build(forCouncil(), true, {
      councilIds: ['c-1', 'c-2', 'c-3'],
      designated: ['c-1'],
      acks: [{ userId: 'c-1', instance: PqrfAddressee.CONSEJO, resolvedAt: new Date() }],
    });

    await service.markResolved('pqrf-1', councilor('c-1'));

    expect(saved.some(p => p.status === PqrfStatus.RESUELTO)).toBe(true);
  });

  it('sin designación responde todo el consejo', async () => {
    const { service, saved } = build(forCouncil(), true, {
      councilIds: ['c-1', 'c-2'],
      acks: [{ userId: 'c-1', instance: PqrfAddressee.CONSEJO, resolvedAt: new Date() }],
    });

    await service.markResolved('pqrf-1', councilor('c-1'));

    expect(saved.some(p => p.status === PqrfStatus.RESUELTO)).toBe(false);
  });

  it('si ningún designado sigue en el consejo, responde el consejo completo', async () => {
    // El único designado dejó el consejo: sin el respaldo, el radicado no
    // tendría a nadie que lo atienda y solo se cerraría por silencio.
    const { service } = build(forCouncil(), true, {
      councilIds: ['c-2', 'c-3'], designated: ['c-1'],
    });

    await expect(service.instanceOf(forCouncil(), councilor('c-2'))).resolves.toBe(PqrfAddressee.CONSEJO);
  });

  it('el aviso de radicado nuevo va solo a los designados', async () => {
    const { service, notify } = build(null, true, {
      councilIds: ['c-1', 'c-2', 'c-3'], designated: ['c-1', 'c-3'],
    });

    await (service as unknown as { notifyAddressees: (p: Pqrf) => Promise<void> })
      .notifyAddressees(forCouncil());

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userIds: ['c-1', 'c-3'] }));
  });

  it('no deja designar a quien no es del consejo', async () => {
    const { service } = build(null, false, { councilIds: ['c-1'] });

    await expect(
      service.updateCouncilResolvers('complex-1', ['intruso'], userOf([ValidRoles.COMPLEX_ROL], 'admin-user')),
    ).rejects.toThrow('Solo puedes elegir a miembros actuales del consejo');
  });
});

describe('PqrfService — cierre por barrido', () => {

  it('cierra el radicado cuando ya respondieron todas las instancias', async () => {
    // Los dos marcaron, pero nadie va a volver a pulsar el botón: quien ya
    // marcó no lo vuelve a ver. Sin el barrido se queda abierto para siempre.
    const { service, saved, notify, pqrfRepo } = build(
      null,
      false,
      {
        adminIds: ['admin-user'],
        councilIds: ['council-user'],
        acks: [
          { userId: 'admin-user',   instance: PqrfAddressee.ADMINISTRACION, resolvedAt: new Date() },
          { userId: 'council-user', instance: PqrfAddressee.CONSEJO,        resolvedAt: new Date() },
        ],
      },
    );
    pqrfRepo.find.mockResolvedValue([
      pqrfOf({ addressee: PqrfAddressee.AMBOS, status: PqrfStatus.EN_TRAMITE }),
    ]);

    const closed = await service.closeFullyAnswered();

    expect(closed).toBe(1);
    expect(saved[saved.length - 1].status).toBe(PqrfStatus.RESUELTO);
    // Es una respuesta de verdad, no un vencimiento.
    expect(saved[saved.length - 1].resolvedBySilence).toBeFalsy();
    expect(notify).toHaveBeenCalled();
  });

  it('no cierra el que todavía espera a una instancia', async () => {
    const { service, saved, pqrfRepo } = build(
      null,
      false,
      {
        adminIds: ['admin-user'],
        councilIds: ['council-user'],
        acks: [
          { userId: 'admin-user', instance: PqrfAddressee.ADMINISTRACION, resolvedAt: new Date() },
        ],
      },
    );
    pqrfRepo.find.mockResolvedValue([
      pqrfOf({ addressee: PqrfAddressee.AMBOS, status: PqrfStatus.EN_TRAMITE }),
    ]);

    const closed = await service.closeFullyAnswered();

    expect(closed).toBe(0);
    expect(saved).toHaveLength(0);
  });

  it('no cierra un radicado que nadie ha atendido', async () => {
    const { service, saved, pqrfRepo } = build(null, false, { adminIds: ['admin-user'], acks: [] });
    pqrfRepo.find.mockResolvedValue([
      pqrfOf({ addressee: PqrfAddressee.ADMINISTRACION, status: PqrfStatus.RADICADO }),
    ]);

    const closed = await service.closeFullyAnswered();

    expect(closed).toBe(0);
    expect(saved).toHaveLength(0);
  });
});

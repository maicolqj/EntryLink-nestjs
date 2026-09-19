import { MaintenanceTicketsService } from './maintenance-tickets.service';
import { MaintenanceTicket } from '../entities/maintenance-ticket.entity';
import { MaintenanceTicketStatus } from '../enums/maintenance-ticket-status.enum';
import { MaintenanceCategory } from '../enums/maintenance-category.enum';
import { MaintenancePriority } from '../enums/maintenance-priority.enum';
import { MaintenanceLocationType } from '../enums/maintenance-location-type.enum';
import { MaintenanceVisibility } from '../enums/maintenance-visibility.enum';
import { MaintenanceAssigneeType } from '../enums/maintenance-assignee-type.enum';

import { MaintenanceErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { User } from '../../users/entities/user.entity';
import { AssignmentStatus } from '../../users/entities/user-complex-assignment.entity';

/**
 * Las reglas del ticket que no se pueden dejar en la pantalla:
 *
 *   1. Califica quien reportó, y calificar CIERRA. Si cualquiera pudiera
 *      calificar, la nota sería una encuesta sobre la administración; y si no
 *      cerrara, el tablero se llenaría de reparados que nadie confirma.
 *   2. La reapertura tiene ventana para el residente y no para la
 *      administración: si el ascensor sigue dañado a los quince días, el plazo
 *      no es el problema.
 *   3. Un ticket no puede tener dos responsables. Con dos, cada uno da por
 *      hecho que lo atiende el otro.
 *   4. El plazo se cuenta desde que el vecino reportó, no desde que la
 *      administración se dignó a revisar.
 */

/** Lo que el servicio le pasa a `notificationsService.notify`. */
interface NotifyPayload {
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  [key: string]: unknown;
}

const userOf = (roles: ValidRoles[], sub = 'user-1'): JwtAccessPayload => ({
  sub,
  email: 'quien@test.com',
  type: 'access',
  entityType: 'user',
  tokenVersion: 1,
  sessionId: 's1',
  roles,
  permissions: [],
  complexId: 'complex-1',
});

const ticketOf = (
  partial: Partial<MaintenanceTicket> = {},
): MaintenanceTicket => ({
  id: 'ticket-1',
  code: 'MTO-000001',
  consecutive: 1,
  title: 'Lámpara fundida en el parqueadero',
  description: 'La del pasillo del sótano 1 lleva tres días apagada',
  category: MaintenanceCategory.ILUMINACION,
  priority: MaintenancePriority.MEDIUM,
  visibility: MaintenanceVisibility.PUBLIC,
  photoUrls: [],
  photoHashes: [],
  closurePhotoUrls: [],
  closurePhotoHashes: [],
  occurredAt: new Date('2026-09-01T10:00:00Z'),
  locationType: MaintenanceLocationType.TREE,
  status: MaintenanceTicketStatus.NEW,
  endorsementCount: 0,
  reopenCount: 0,
  reportedByUserId: 'resident-1',
  complexId: 'complex-1',
  createdAt: new Date('2026-09-01T10:00:00Z'),
  updatedAt: new Date('2026-09-01T10:00:00Z'),
  ...partial,
});

/** Doble del QueryBuilder con que el servicio busca al personal de mantenimiento. */
interface StaffQueryDouble {
  innerJoin: jest.Mock<StaffQueryDouble, unknown[]>;
  where: jest.Mock<StaffQueryDouble, unknown[]>;
  andWhere: jest.Mock<StaffQueryDouble, [string, { userId?: string }?]>;
  orderBy: jest.Mock<StaffQueryDouble, unknown[]>;
  addOrderBy: jest.Mock<StaffQueryDouble, unknown[]>;
  getMany: jest.Mock<Promise<Partial<User>[]>, []>;
  getOne: jest.Mock<Promise<Partial<User> | null>, []>;
}

const buildHarness = (
  ticket: MaintenanceTicket = ticketOf(),
  complexOverrides: Record<string, unknown> = {},
  /** Lo que devuelve la consulta de personal de aseo y mantenimiento. */
  maintenanceStaff: Partial<User>[] = [],
) => {
  const saved: MaintenanceTicket[] = [];

  // La consulta real filtra por asignación activa de MAINTENANCE_ROL; aquí se
  // simula el resultado y se guardan los filtros para revisarlos.
  let requestedUserId: string | undefined;
  const staffQuery: StaffQueryDouble = {
    innerJoin: jest.fn(() => staffQuery),
    where: jest.fn(() => staffQuery),
    andWhere: jest.fn((_sql: string, params?: { userId?: string }) => {
      requestedUserId = params?.userId;
      return staffQuery;
    }),
    orderBy: jest.fn(() => staffQuery),
    addOrderBy: jest.fn(() => staffQuery),
    getMany: jest.fn(() => Promise.resolve(maintenanceStaff)),
    getOne: jest.fn(() =>
      Promise.resolve(
        maintenanceStaff.find((user) => user.id === requestedUserId) ?? null,
      ),
    ),
  };
  const userRepo = { createQueryBuilder: jest.fn(() => staffQuery) };

  // Cada consulta del tablero registra su estado y su orden para revisarlos.
  const boardQueries: { status?: string; orderBy: [string, string?][] }[] = [];
  const recordingQuery = () => {
    const record: { status?: string; orderBy: [string, string?][] } = {
      orderBy: [],
    };
    boardQueries.push(record);
    const qb: Record<string, jest.Mock> = {};
    for (const method of [
      'where',
      'leftJoinAndSelect',
      'addOrderBy',
      'limit',
    ]) {
      qb[method] = jest.fn(() => qb);
    }
    qb.andWhere = jest.fn((sql: string, params?: { status?: string }) => {
      if (sql === 't.status = :status') record.status = params?.status;
      return qb;
    });
    qb.orderBy = jest.fn((sort: string, order?: string) => {
      record.orderBy.push([sort, order]);
      return qb;
    });
    qb.getCount = jest.fn(() => Promise.resolve(0));
    qb.getMany = jest.fn(() => Promise.resolve([]));
    return qb;
  };

  const ticketRepo = {
    createQueryBuilder: jest.fn(recordingQuery),
    findOne: jest.fn(() => Promise.resolve(ticket)),
    save: jest.fn((entity: MaintenanceTicket) => {
      saved.push(entity);
      return Promise.resolve(entity);
    }),
    increment: jest.fn(() => Promise.resolve({ affected: 1 })),
    count: jest.fn(() => Promise.resolve(0)),
  };

  const eventRepo = {
    create: jest.fn((data: unknown) => data),
    save: jest.fn((data: unknown) => Promise.resolve(data)),
  };

  const endorsementRepo = {
    find: jest.fn(() => Promise.resolve([])),
    findOne: jest.fn(() => Promise.resolve(null)),
    create: jest.fn((data: unknown) => data),
    save: jest.fn((data: unknown) => Promise.resolve(data)),
  };

  const slaService = {
    resolveHours: jest.fn(() => Promise.resolve(72)),
    dueAtFrom: jest.fn(
      (from: Date, hours: number) =>
        new Date(from.getTime() + hours * 3_600_000),
    ),
  };

  const notificationsService = {
    // El payload se declara tipado —y se devuelve— para poder inspeccionarlo:
    // el servicio ignora lo que retorna `notify`.
    notify: jest.fn((payload: NotifyPayload) => Promise.resolve([payload])),
    findUserIdsByRoles: jest.fn(() => Promise.resolve(['admin-1'])),
  };

  const locationsService = {
    resolveLocation: jest.fn(() => Promise.resolve({})),
  };

  /**
   * Corre el callback de verdad con un manager de mentira: sin esto no se puede
   * probar `create()`, que es donde vive el consecutivo y el aviso.
   */
  const dataSource = {
    transaction: jest.fn((cb: (manager: unknown) => unknown) =>
      Promise.resolve(
        cb({
          query: jest.fn(() => Promise.resolve([])),
          createQueryBuilder: jest.fn(() => ({
            select: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            getRawOne: jest.fn(() => Promise.resolve({ max: 0 })),
          })),
          create: jest.fn((_entity: unknown, data: unknown) => data),
          save: jest.fn((data: unknown) => Promise.resolve(data)),
        }),
      ),
    ),
  };

  const service = new MaintenanceTicketsService(
    ticketRepo as never,
    eventRepo as never,
    endorsementRepo as never,
    userRepo as never,
    locationsService as never,
    { findByIdOrFail: jest.fn() } as never, // vendorsService
    slaService as never,
    {
      findById: jest.fn(() =>
        Promise.resolve({
          id: 'complex-1',
          slug: 'complejo',
          enabledModules: ['MANTENIMIENTO'],
          maintenanceResidentReportingEnabled: true,
          maintenanceReopenWindowDays: 7,
          ...complexOverrides,
        }),
      ),
      assertComplexAccess: jest.fn(() => Promise.resolve(undefined)),
    } as never, // complexService
    {
      findActiveResidentByUserIdInternal: jest.fn(() =>
        Promise.resolve({ id: 'resident-1', unitId: 'unit-1' }),
      ),
    } as never, // residentsService
    notificationsService as never,
    { log: jest.fn() } as never, // auditService
    { emitToComplex: jest.fn(), emitToUnit: jest.fn() } as never, // socketService
    dataSource as never,
  );

  return {
    service,
    ticketRepo,
    boardQueries,
    eventRepo,
    endorsementRepo,
    slaService,
    notificationsService,
    locationsService,
    staffQuery,
    saved,
  };
};

describe('MaintenanceTicketsService — calificación', () => {
  it('solo la hace quien reportó', async () => {
    const { service } = buildHarness(
      ticketOf({ status: MaintenanceTicketStatus.RESOLVED }),
    );

    await expect(
      service.rate(
        { ticketId: 'ticket-1', rating: 5 },
        userOf([ValidRoles.RESIDENT_ROL], 'otro-vecino'),
      ),
    ).rejects.toMatchObject({
      errorCode: MaintenanceErrorCode.MAINTENANCE_RATING_NOT_ALLOWED,
    });
  });

  it('no se puede calificar lo que todavía no repararon', async () => {
    const { service } = buildHarness(
      ticketOf({ status: MaintenanceTicketStatus.IN_PROGRESS }),
    );

    await expect(
      service.rate(
        { ticketId: 'ticket-1', rating: 5 },
        userOf([ValidRoles.RESIDENT_ROL], 'resident-1'),
      ),
    ).rejects.toMatchObject({
      errorCode: MaintenanceErrorCode.MAINTENANCE_TICKET_INVALID_STATUS,
    });
  });

  it('calificar cierra el ticket: es la confirmación del residente', async () => {
    const { service, saved } = buildHarness(
      ticketOf({ status: MaintenanceTicketStatus.RESOLVED }),
    );

    await service.rate(
      { ticketId: 'ticket-1', rating: 4, comment: 'Quedó bien' },
      userOf([ValidRoles.RESIDENT_ROL], 'resident-1'),
    );

    expect(saved[0].status).toBe(MaintenanceTicketStatus.CLOSED);
    expect(saved[0].rating).toBe(4);
    expect(saved[0].closedAt).toBeTruthy();
  });

  it('no se califica dos veces', async () => {
    const { service } = buildHarness(
      ticketOf({ status: MaintenanceTicketStatus.RESOLVED, rating: 5 }),
    );

    await expect(
      service.rate(
        { ticketId: 'ticket-1', rating: 1 },
        userOf([ValidRoles.RESIDENT_ROL], 'resident-1'),
      ),
    ).rejects.toMatchObject({
      errorCode: MaintenanceErrorCode.MAINTENANCE_ALREADY_RATED,
    });
  });
});

describe('MaintenanceTicketsService — reapertura', () => {
  const resolvedLongAgo = () =>
    ticketOf({
      status: MaintenanceTicketStatus.CLOSED,
      resolvedAt: new Date(Date.now() - 30 * 24 * 3_600_000),
      closedAt: new Date(Date.now() - 30 * 24 * 3_600_000),
    });

  it('el residente no reabre fuera de la ventana', async () => {
    const { service } = buildHarness(resolvedLongAgo());

    await expect(
      service.reopen(
        'ticket-1',
        'La lámpara volvió a fundirse',
        userOf([ValidRoles.RESIDENT_ROL], 'resident-1'),
      ),
    ).rejects.toMatchObject({
      errorCode: MaintenanceErrorCode.MAINTENANCE_REOPEN_WINDOW_CLOSED,
    });
  });

  it('la administración sí: el daño no respeta plazos', async () => {
    const { service, saved } = buildHarness(resolvedLongAgo());

    await service.reopen(
      'ticket-1',
      'Sigue sin funcionar y el proveedor no volvió',
      userOf([ValidRoles.COMPLEX_ROL], 'admin-1'),
    );

    expect(saved[0].status).toBe(MaintenanceTicketStatus.TRIAGED);
    expect(saved[0].reopenCount).toBe(1);
    // Plazo nuevo desde la reapertura: arrastrar el viejo lo dejaría vencido
    // desde el primer segundo.
    expect(saved[0].slaBreachedAt).toBeNull();
    expect(saved[0].slaDueAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('el residente no reabre dos veces el mismo ticket', async () => {
    const { service } = buildHarness(
      ticketOf({
        status: MaintenanceTicketStatus.RESOLVED,
        resolvedAt: new Date(),
        reopenCount: 1,
      }),
    );

    await expect(
      service.reopen(
        'ticket-1',
        'Sigue mal',
        userOf([ValidRoles.RESIDENT_ROL], 'resident-1'),
      ),
    ).rejects.toMatchObject({
      errorCode: MaintenanceErrorCode.MAINTENANCE_REOPEN_LIMIT,
    });
  });
});

const STAFF_ID = '33333333-3333-4333-8333-333333333333';
const staffMember: Partial<User> = {
  id: STAFF_ID,
  name: 'Pedro',
  lastName: 'Gómez',
  phoneNumber: '3001234567',
  email: 'pedro@test.com',
};

describe('MaintenanceTicketsService — asignación', () => {
  it('no admite personal interno y proveedor a la vez', async () => {
    const { service } = buildHarness(
      ticketOf({ status: MaintenanceTicketStatus.TRIAGED }),
    );

    await expect(
      service.assign(
        {
          ticketId: 'ticket-1',
          assigneeType: MaintenanceAssigneeType.INTERNAL,
          assignedUserId: '11111111-1111-4111-8111-111111111111',
          vendorId: '22222222-2222-4222-8222-222222222222',
        },
        userOf([ValidRoles.COMPLEX_ROL], 'admin-1'),
      ),
    ).rejects.toMatchObject({
      errorCode: MaintenanceErrorCode.MAINTENANCE_ASSIGNEE_CONFLICT,
    });
  });

  it('exige responsable', async () => {
    const { service } = buildHarness(
      ticketOf({ status: MaintenanceTicketStatus.TRIAGED }),
    );

    await expect(
      service.assign(
        {
          ticketId: 'ticket-1',
          assigneeType: MaintenanceAssigneeType.VENDOR,
        },
        userOf([ValidRoles.COMPLEX_ROL], 'admin-1'),
      ),
    ).rejects.toMatchObject({
      errorCode: MaintenanceErrorCode.MAINTENANCE_ASSIGNEE_REQUIRED,
    });
  });

  it('asigna a personal interno de aseo y mantenimiento', async () => {
    const { service, saved } = buildHarness(
      ticketOf({ status: MaintenanceTicketStatus.TRIAGED }),
      {},
      [staffMember],
    );

    await service.assign(
      {
        ticketId: 'ticket-1',
        assigneeType: MaintenanceAssigneeType.INTERNAL,
        assignedUserId: STAFF_ID,
      },
      userOf([ValidRoles.COMPLEX_ROL], 'admin-1'),
    );

    expect(saved[0].assignedUserId).toBe(STAFF_ID);
    expect(saved[0].vendorId).toBeNull();
  });

  it('rechaza a quien no es personal de mantenimiento del complejo', async () => {
    // Un residente o un guardia del mismo complejo no sale en la consulta.
    const { service } = buildHarness(
      ticketOf({ status: MaintenanceTicketStatus.TRIAGED }),
      {},
      [staffMember],
    );

    await expect(
      service.assign(
        {
          ticketId: 'ticket-1',
          assigneeType: MaintenanceAssigneeType.INTERNAL,
          assignedUserId: '44444444-4444-4444-8444-444444444444',
        },
        userOf([ValidRoles.COMPLEX_ROL], 'admin-1'),
      ),
    ).rejects.toMatchObject({
      errorCode: MaintenanceErrorCode.MAINTENANCE_ASSIGNEE_NOT_IN_COMPLEX,
    });
  });
});

describe('MaintenanceTicketsService — tablero', () => {
  it('cada estado tiene su columna, también los cerrados', async () => {
    const { service } = buildHarness();

    const board = await service.board(
      'complex-1',
      {},
      userOf([ValidRoles.COMPLEX_ROL], 'admin-1'),
    );

    expect(board.columns.map((column) => column.status)).toEqual([
      MaintenanceTicketStatus.NEW,
      MaintenanceTicketStatus.TRIAGED,
      MaintenanceTicketStatus.ASSIGNED,
      MaintenanceTicketStatus.IN_PROGRESS,
      MaintenanceTicketStatus.ON_HOLD,
      MaintenanceTicketStatus.RESOLVED,
      MaintenanceTicketStatus.CLOSED,
      MaintenanceTicketStatus.REJECTED,
      MaintenanceTicketStatus.DUPLICATE,
    ]);
  });

  it('en los cerrados va arriba lo más reciente; en los abiertos, lo urgente', async () => {
    const { service, boardQueries } = buildHarness();

    await service.board(
      'complex-1',
      {},
      userOf([ValidRoles.COMPLEX_ROL], 'admin-1'),
    );

    const ordered = (status: MaintenanceTicketStatus) =>
      boardQueries.find(
        (q) => q.status === (status as string) && q.orderBy.length > 0,
      )?.orderBy[0];
    expect(ordered(MaintenanceTicketStatus.CLOSED)).toEqual([
      't.updatedAt',
      'DESC',
    ]);
    expect(ordered(MaintenanceTicketStatus.NEW)?.[0]).toContain(
      'CASE t.priority',
    );
  });
});

describe('MaintenanceTicketsService — personal de aseo y mantenimiento', () => {
  it('filtra por asignación activa de MAINTENANCE_ROL en el complejo', async () => {
    const { service, staffQuery } = buildHarness();

    await service.findMaintenanceStaff(
      'complex-1',
      userOf([ValidRoles.COMPLEX_ROL], 'admin-1'),
    );

    expect(staffQuery.innerJoin).toHaveBeenCalledWith(
      expect.anything(),
      'a',
      expect.any(String),
      {
        complexId: 'complex-1',
        role: ValidRoles.MAINTENANCE_ROL,
        assignmentStatus: AssignmentStatus.ACTIVE,
      },
    );
  });

  it('devuelve solo lo necesario para elegir por nombre', async () => {
    const { service } = buildHarness(ticketOf(), {}, [
      { ...staffMember, password: 'hash' },
    ]);

    const staff = await service.findMaintenanceStaff(
      'complex-1',
      userOf([ValidRoles.COMPLEX_ROL], 'admin-1'),
    );

    expect(staff).toEqual([
      {
        id: STAFF_ID,
        name: 'Pedro',
        lastName: 'Gómez',
        phoneNumber: '3001234567',
      },
    ]);
  });
});

describe('MaintenanceTicketsService — el plazo corre desde que el vecino reportó', () => {
  it('el triage recalcula el vencimiento desde la radicación, no desde hoy', async () => {
    const createdAt = new Date(Date.now() - 48 * 3_600_000);
    const { service, saved } = buildHarness(ticketOf({ createdAt }));

    await service.triage(
      { ticketId: 'ticket-1', priority: MaintenancePriority.HIGH },
      userOf([ValidRoles.COMPLEX_ROL], 'admin-1'),
    );

    // 72 horas del mock, contadas desde la radicación: quedan 24 por delante.
    expect(saved[0].slaDueAt.getTime()).toBe(
      createdAt.getTime() + 72 * 3_600_000,
    );
    expect(saved[0].status).toBe(MaintenanceTicketStatus.TRIAGED);
  });

  it('un ticket ya revisado no se vuelve a revisar', async () => {
    const { service } = buildHarness(
      ticketOf({ status: MaintenanceTicketStatus.ASSIGNED }),
    );

    await expect(
      service.triage(
        { ticketId: 'ticket-1' },
        userOf([ValidRoles.COMPLEX_ROL], 'admin-1'),
      ),
    ).rejects.toMatchObject({
      errorCode: MaintenanceErrorCode.MAINTENANCE_TICKET_INVALID_STATUS,
    });
  });
});

describe('MaintenanceTicketsService — adhesiones', () => {
  it('quien ya reportó no se adhiere a su propio ticket', async () => {
    const { service } = buildHarness();

    await expect(
      service.endorse(
        'ticket-1',
        undefined,
        userOf([ValidRoles.RESIDENT_ROL], 'resident-1'),
      ),
    ).rejects.toMatchObject({
      errorCode: MaintenanceErrorCode.MAINTENANCE_ALREADY_ENDORSED,
    });
  });

  it('no se puede sumar a un ticket ya cerrado', async () => {
    const { service } = buildHarness(
      ticketOf({ status: MaintenanceTicketStatus.CLOSED }),
    );

    await expect(
      service.endorse(
        'ticket-1',
        undefined,
        userOf([ValidRoles.RESIDENT_ROL], 'vecino-2'),
      ),
    ).rejects.toMatchObject({
      errorCode: MaintenanceErrorCode.MAINTENANCE_ENDORSE_CLOSED,
    });
  });

  it('el contador sube en la base, no en memoria', async () => {
    const { service, ticketRepo } = buildHarness();

    await service.endorse(
      'ticket-1',
      'A mí también me pasa',
      userOf([ValidRoles.RESIDENT_ROL], 'vecino-2'),
    );

    expect(ticketRepo.increment).toHaveBeenCalledWith(
      { id: 'ticket-1' },
      'endorsementCount',
      1,
    );
  });
});

describe('MaintenanceTicketsService — el aviso cuenta DÓNDE', () => {
  /**
   * El bug que esto congela: el aviso se armaba con la entidad que devolvía
   * `save()`, que trae los ids pero no las relaciones. La administración recibía
   * "Zona común" aunque el residente hubiera señalado torre y piso, y salía a
   * buscar el daño a ciegas.
   */
  const located = () =>
    ticketOf({
      buildingId: 'building-1',
      floor: -1,
      locationText: 'junto al parqueadero 45',
      building: { id: 'building-1', name: 'Torre 2' } as never,
      reportedByUnit: { id: 'unit-1', number: '302' } as never,
    });

  const createData = {
    complexId: 'complex-1',
    title: 'Lámpara fundida en el sótano',
    description: 'Lleva tres días apagada y no se ve nada',
    category: MaintenanceCategory.ILUMINACION,
    locationType: MaintenanceLocationType.TREE,
    photoUrls: ['https://files.alternaqj.com/foto.jpg'],
    photoHashes: ['abc'],
  };

  it('el aviso a la administración nombra la torre y el piso', async () => {
    const ticket = located();
    const { service, notificationsService, locationsService } =
      buildHarness(ticket);

    locationsService.resolveLocation.mockResolvedValue({
      locationType: MaintenanceLocationType.TREE,
      buildingId: 'building-1',
      floor: -1,
      locationText: 'junto al parqueadero 45',
      amenityId: null,
      locationTagId: null,
      lat: null,
      lng: null,
      gpsAccuracyMeters: null,
    });

    await service.create(
      createData,
      userOf([ValidRoles.RESIDENT_ROL], 'resident-1'),
    );

    const call = notificationsService.notify.mock.calls[0][0];

    expect(call.body).toContain('Torre 2');
    expect(call.metadata.buildingName).toBe('Torre 2');
    // Los sótanos se guardan negativos: "-1" no se lee, "Sótano 1" sí.
    expect(call.metadata.floorLabel).toBe('Sótano 1');
    expect(call.metadata.locationReference).toBe('junto al parqueadero 45');
    expect(call.metadata.unitNumber).toBe('302');
  });

  it('no manda claves vacías: una ficha con renglones en blanco se lee peor', async () => {
    const ticket = ticketOf({ locationText: null, building: undefined });
    const { service, notificationsService, locationsService } =
      buildHarness(ticket);

    locationsService.resolveLocation.mockResolvedValue({
      locationType: MaintenanceLocationType.TREE,
      buildingId: null,
      floor: null,
      locationText: null,
      amenityId: null,
      locationTagId: null,
      lat: null,
      lng: null,
      gpsAccuracyMeters: null,
    });

    await service.create(
      createData,
      userOf([ValidRoles.RESIDENT_ROL], 'resident-1'),
    );

    const call = notificationsService.notify.mock.calls[0][0];

    expect(call.metadata).not.toHaveProperty('buildingName');
    expect(call.metadata).not.toHaveProperty('floorLabel');
    expect(call.metadata.code).toBe('MTO-000001');
  });
});

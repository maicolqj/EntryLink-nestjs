import { PetIncidentsService } from './pet-incidents.service';
import { PetIncident } from '../entities/pet-incident.entity';
import { PetIncidentStatus } from '../enums/pet-incident-status.enum';
import { PetIncidentType } from '../enums/pet-incident-type.enum';
import { PetIncidentSeverity } from '../enums/pet-incident-severity.enum';
import { PetSanction } from '../enums/pet-sanction.enum';

import { PetsNotificationDetailProvider } from '../providers/pets-notification-detail.provider';
import { CustomError } from '../../shared/utils/errors.utils';
import { PetErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

/**
 * Specs de las dos reglas que sostienen el módulo:
 *
 *   1. Quien reporta no le queda expuesto al vecino que reportó. Si esto se
 *      rompe, nadie vuelve a reportar nada.
 *   2. No se sanciona sin haber oído a la unidad (Ley 675, art. 59). Si esto se
 *      rompe, la multa es anulable y el módulo produce problemas en vez de
 *      resolverlos.
 */

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

const incidentOf = (partial: Partial<PetIncident> = {}): PetIncident =>
  ({
    id: 'incident-1',
    code: 'MAS-000001',
    consecutive: 1,
    complexId: 'complex-1',
    type: PetIncidentType.WASTE_NOT_PICKED_UP,
    severity: PetIncidentSeverity.MEDIUM,
    description:
      'El perro dejó deposiciones en la zona verde y no las recogió.',
    photoUrls: ['https://files.alternaqj.com/evidencia-1.jpg'],
    photoHashes: ['abc123'],
    occurredAt: new Date('2026-09-10T14:00:00Z'),
    status: PetIncidentStatus.UNDER_DEFENSE,
    petId: 'pet-1',
    unitId: 'unit-1',
    reportedByUserId: 'vecino-9',
    reportedByName: 'ANA VECINA',
    reportedByRole: ValidRoles.RESIDENT_ROL,
    reportedByUnitId: 'unit-9',
    ...partial,
  }) as PetIncident;

interface Harness {
  service: PetIncidentsService;
  incidents: { findOne: jest.Mock; save: jest.Mock; count: jest.Mock };
  statements: { count: jest.Mock; save: jest.Mock; create: jest.Mock };
  notify: jest.Mock;
  emitPetFineCharge: jest.Mock;
}

const buildHarness = (overrides: Partial<Harness> = {}): Harness => {
  const incidents = {
    findOne: jest.fn(),
    save: jest.fn((incident: PetIncident) => Promise.resolve(incident)),
    count: jest.fn(() => Promise.resolve(0)),
    find: jest.fn(() => Promise.resolve([])),
    createQueryBuilder: jest.fn(),
  };

  const statements = {
    count: jest.fn(() => Promise.resolve(0)),
    save: jest.fn((s: unknown) => Promise.resolve(s)),
    create: jest.fn((s: unknown) => s),
  };

  const notify = jest.fn(() => Promise.resolve([]));
  const emitPetFineCharge = jest.fn(() =>
    Promise.resolve({
      chargeId: 'charge-1',
      accountingHeaderId: 'header-1',
    }),
  );

  const service = new PetIncidentsService(
    incidents as never,
    statements as never,
    {
      findOne: jest.fn(() =>
        Promise.resolve({
          id: 'pet-1',
          complexId: 'complex-1',
          unitId: 'unit-1',
        }),
      ),
    } as never, // petRepo
    {
      findById: jest.fn(() =>
        Promise.resolve({
          id: 'complex-1',
          enabledModules: ['MASCOTAS'],
          petsResidentReportingEnabled: true,
          petsStatementDays: 5,
          ownerId: 'owner-1',
        }),
      ),
      assertComplexAccess: jest.fn(() => Promise.resolve(undefined)),
    } as never, // complexService
    {
      findById: jest.fn(() =>
        Promise.resolve({ id: 'unit-1', complexId: 'complex-1' }),
      ),
    } as never, // unitService
    {
      findActiveByUnitInternal: jest.fn(() =>
        Promise.resolve([{ userId: 'resident-user-1' }]),
      ),
      findActiveResidentByUserIdInternal: jest.fn(() =>
        Promise.resolve({
          id: 'resident-1',
          unitId: 'unit-1',
          user: { name: 'PEDRO', lastName: 'RESIDENTE' },
        }),
      ),
    } as never, // residentsService
    {
      notify,
      findUserIdsByRoles: jest.fn(() => Promise.resolve(['admin-1'])),
    } as never,
    { emitPetFineCharge } as never, // accountingService
    { log: jest.fn() } as never, // auditService
    { emitToComplex: jest.fn(), emitToUnit: jest.fn() } as never,
    {
      transaction: jest.fn((cb: (em: unknown) => unknown) =>
        Promise.resolve(cb({})),
      ),
    } as never, // dataSource
  );

  return {
    service,
    incidents: incidents,
    statements: statements,
    notify,
    emitPetFineCharge,
    ...overrides,
  };
};

describe('PetIncidentsService — identidad de quien reporta', () => {
  it('le oculta al residente acusado quién lo reportó', async () => {
    const h = buildHarness();
    h.incidents.findOne.mockResolvedValue(incidentOf());

    const result = await h.service.findById(
      'incident-1',
      userOf([ValidRoles.RESIDENT_ROL], 'resident-user-1'),
    );

    expect(result.reportedByName).toBeNull();
    expect(result.reportedByUserId).toBeNull();
    expect(result.reportedByUnitId).toBeNull();
  });

  it('la administración sí ve quién reportó', async () => {
    const h = buildHarness();
    h.incidents.findOne.mockResolvedValue(incidentOf());

    const result = await h.service.findById(
      'incident-1',
      userOf([ValidRoles.COMPLEX_ROL], 'admin-1'),
    );

    expect(result.reportedByName).toBe('ANA VECINA');
  });
});

describe('PetIncidentsService — debido proceso antes de sancionar', () => {
  const futureDeadline = () => {
    const date = new Date();
    date.setDate(date.getDate() + 3);
    return date;
  };

  it('no deja multar mientras el plazo de descargos siga corriendo', async () => {
    const h = buildHarness();
    h.incidents.findOne.mockResolvedValue(
      incidentOf({ statementDueAt: futureDeadline() }),
    );
    h.statements.count.mockResolvedValue(0);

    await expect(
      h.service.sanction(
        {
          incidentId: 'incident-1',
          sanction: PetSanction.FINE,
          fineAmount: 50000,
          resolutionNotes: 'Reincidencia comprobada con evidencia fotográfica.',
        },
        userOf([ValidRoles.COMPLEX_ROL], 'admin-1'),
      ),
    ).rejects.toMatchObject({
      errorCode: PetErrorCode.PET_INCIDENT_DEFENSE_WINDOW_OPEN,
    });

    expect(h.emitPetFineCharge).not.toHaveBeenCalled();
  });

  it('deja multar antes del plazo si la unidad ya presentó descargos', async () => {
    const h = buildHarness();
    h.incidents.findOne.mockResolvedValue(
      incidentOf({ statementDueAt: futureDeadline() }),
    );
    // Ya fue oída: esperar el resto del plazo no agrega garantía.
    h.statements.count.mockResolvedValue(1);

    const result = await h.service.sanction(
      {
        incidentId: 'incident-1',
        sanction: PetSanction.FINE,
        fineAmount: 50000,
        resolutionNotes: 'Los descargos no desvirtúan la evidencia aportada.',
      },
      userOf([ValidRoles.COMPLEX_ROL], 'admin-1'),
    );

    expect(h.emitPetFineCharge).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(PetIncidentStatus.FINED);
    expect(result.fineChargeId).toBe('charge-1');
  });

  it('exige el valor cuando la sanción es una multa', async () => {
    const h = buildHarness();
    h.incidents.findOne.mockResolvedValue(
      incidentOf({ statementDueAt: new Date('2026-01-01T00:00:00Z') }),
    );

    await expect(
      h.service.sanction(
        {
          incidentId: 'incident-1',
          sanction: PetSanction.FINE,
          resolutionNotes: 'Multa por reincidencia en zona no autorizada.',
        },
        userOf([ValidRoles.COMPLEX_ROL], 'admin-1'),
      ),
    ).rejects.toMatchObject({
      errorCode: PetErrorCode.PET_INCIDENT_FINE_AMOUNT_REQUIRED,
    });
  });

  it('no deja sancionar un reporte que nadie ha validado', async () => {
    const h = buildHarness();
    h.incidents.findOne.mockResolvedValue(
      incidentOf({ status: PetIncidentStatus.REPORTED }),
    );

    await expect(
      h.service.sanction(
        {
          incidentId: 'incident-1',
          sanction: PetSanction.WARNING,
          resolutionNotes: 'Llamado de atención por deposiciones.',
        },
        userOf([ValidRoles.COMPLEX_ROL], 'admin-1'),
      ),
    ).rejects.toBeInstanceOf(CustomError);
  });
});

describe('PetIncidentsService — evidencia obligatoria', () => {
  it('rechaza un reporte sin fotos', async () => {
    const h = buildHarness();

    await expect(
      h.service.report(
        {
          complexId: 'complex-1',
          type: PetIncidentType.WASTE_NOT_PICKED_UP,
          description: 'Dejó deposiciones en el pasillo del primer piso.',
          photoUrls: [],
          photoHashes: [],
        },
        userOf([ValidRoles.RESIDENT_ROL], 'resident-user-1'),
      ),
    ).rejects.toMatchObject({
      errorCode: PetErrorCode.PET_INCIDENT_EVIDENCE_REQUIRED,
    });
  });
});

describe('PetIncidentsService — el aviso apunta a algo que sepan contar', () => {
  it('notifica con un entityType que el proveedor del expediente resuelve', async () => {
    const h = buildHarness();
    h.incidents.findOne.mockResolvedValue(
      incidentOf({ status: PetIncidentStatus.REPORTED }),
    );

    await h.service.validate(
      { incidentId: 'incident-1', unitId: 'unit-1' },
      userOf([ValidRoles.COMPLEX_ROL], 'admin-1'),
    );

    expect(h.notify).toHaveBeenCalled();

    // Si el nombre que se guarda en el aviso no está en la lista del proveedor,
    // el expediente cae al fallback de `metadata`: el administrador abre el
    // aviso y no ve ni el relato ni las fotos de la evidencia.
    const provider = new PetsNotificationDetailProvider(null, null, null);
    const resolvable = new Set(
      provider.entityTypes.map((t) => t.toLowerCase()),
    );

    for (const [payload] of h.notify.mock.calls) {
      expect(resolvable.has(String(payload.entityType).toLowerCase())).toBe(
        true,
      );
    }
  });
});

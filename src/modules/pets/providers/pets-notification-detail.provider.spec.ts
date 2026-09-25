import {
  PetActionCode,
  PetsNotificationDetailProvider,
} from './pets-notification-detail.provider';
import { PetIncident } from '../entities/pet-incident.entity';
import { PetIncidentStatus } from '../enums/pet-incident-status.enum';
import { PetIncidentType } from '../enums/pet-incident-type.enum';
import { PetIncidentSeverity } from '../enums/pet-incident-severity.enum';
import { PetSanction } from '../enums/pet-sanction.enum';

import { Notification } from '../../notifications/entities/notification.entity';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

/**
 * Qué botones aparecen —y cuáles aparecen apagados— cuando se abre el aviso.
 *
 * El expediente no puede ofrecer un trámite que el servicio va a rechazar: un
 * administrador que escribe la motivación de una multa y la pierde contra un
 * error del servidor termina haciendo el trámite por fuera del sistema.
 */

const userOf = (roles: ValidRoles[], sub = 'admin-1'): JwtAccessPayload => ({
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
    complexId: 'complex-1',
    type: PetIncidentType.WASTE_NOT_PICKED_UP,
    severity: PetIncidentSeverity.MEDIUM,
    description: 'Dejó deposiciones en la zona verde.',
    photoUrls: ['https://files.alternaqj.com/evidencia-1.jpg'],
    photoHashes: ['abc123'],
    occurredAt: new Date('2026-09-10T14:00:00Z'),
    status: PetIncidentStatus.REPORTED,
    petId: null,
    unitId: null,
    statements: [],
    reportedByUserId: 'vecino-9',
    reportedByName: 'ANA VECINA',
    createdAt: new Date('2026-09-10T15:00:00Z'),
    ...partial,
  }) as PetIncident;

const notificationOf = (): Notification =>
  ({
    id: 'notif-1',
    complexId: 'complex-1',
    entityType: 'pet_incident',
    entityId: 'incident-1',
    metadata: {},
  }) as Notification;

const inDays = (days: number): Date => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
};

const buildHarness = (incident: PetIncident) => {
  const validate = jest.fn(() => Promise.resolve(incident));
  const sanction = jest.fn(() => Promise.resolve(incident));
  const dismiss = jest.fn(() => Promise.resolve(incident));
  const addStatement = jest.fn(() => Promise.resolve(incident));

  const incidentsService = {
    findById: jest.fn(() => Promise.resolve(incident)),
    validate,
    sanction,
    dismiss,
    addStatement,
  };

  const petsService = {
    findByComplex: jest.fn(() =>
      Promise.resolve({
        items: [
          {
            id: 'pet-1',
            name: 'KODA',
            breed: 'Golden retriever',
            unit: { number: '101', building: { name: 'Torre A' } },
          },
        ],
      }),
    ),
  };

  const provider = new PetsNotificationDetailProvider(
    { register: jest.fn() } as never,
    petsService as never,
    incidentsService as never,
  );

  return { provider, validate, sanction, dismiss, addStatement };
};

const actionsFor = async (
  incident: PetIncident,
  currentUser: JwtAccessPayload,
) => {
  const { provider } = buildHarness(incident);
  const snapshot = await provider.build({
    notification: notificationOf(),
    currentUser,
  });
  return snapshot?.actions ?? [];
};

describe('PetsNotificationDetailProvider — qué se puede hacer desde el aviso', () => {
  const manager = userOf([ValidRoles.COMPLEX_ROL]);

  it('un reporte recién radicado se puede tramitar o desestimar', async () => {
    const actions = await actionsFor(incidentOf(), manager);

    expect(actions.map((a) => a.code)).toEqual([
      PetActionCode.INCIDENT_VALIDATE,
      PetActionCode.INCIDENT_DISMISS,
    ]);
  });

  it('el censo llega con la torre al lado: un "101" suelto no identifica nada', async () => {
    const actions = await actionsFor(incidentOf(), manager);
    const validate = actions.find(
      (a) => a.code === PetActionCode.INCIDENT_VALIDATE,
    );

    const pet = validate?.fields.find((f) => f.name === 'petId');

    expect(pet?.options?.[0]).toMatchObject({
      value: 'pet-1',
      label: 'KODA · Golden retriever',
      hint: 'Torre A · 101',
    });
  });

  it('la unidad se pide con buscador, no con la lista entera del complejo', async () => {
    const actions = await actionsFor(
      incidentOf({
        unitId: 'unit-1',
        unit: { number: '101', building: { name: 'Torre A' } } as never,
      }),
      manager,
    );
    const unit = actions
      .find((a) => a.code === PetActionCode.INCIDENT_VALIDATE)
      ?.fields.find((f) => f.name === 'unitId');

    // Sin `options`: mandar cientos de apartamentos para elegir uno es un
    // payload enorme, y el buscador de la web ya consulta al servidor.
    expect(unit?.kind).toBe('UNIT');
    expect(unit?.options).toBeNull();
    // Prellenado y legible: quien valida ve "Torre A · 101", no un UUID.
    expect(unit?.defaultValue).toBe('unit-1');
    expect(unit?.defaultLabel).toBe('Torre A · 101');
  });

  it('no deja multar mientras la unidad tenga plazo para responder', async () => {
    const actions = await actionsFor(
      incidentOf({
        status: PetIncidentStatus.UNDER_DEFENSE,
        unitId: 'unit-1',
        statementDueAt: inDays(3),
        statements: [],
      }),
      manager,
    );

    const fine = actions.find((a) => a.code === PetActionCode.INCIDENT_FINE);

    // Apagada y con el motivo a la vista: un botón que desaparece parece un
    // error de la pantalla, uno en gris explica el debido proceso.
    expect(fine?.isEnabled).toBe(false);
    expect(fine?.disabledReason).toContain('plazo');
  });

  it('si la unidad ya presentó descargos, se puede sancionar de inmediato', async () => {
    const actions = await actionsFor(
      incidentOf({
        status: PetIncidentStatus.UNDER_DEFENSE,
        unitId: 'unit-1',
        statementDueAt: inDays(3),
        statements: [{ id: 'st-1', isDefense: true }] as never,
      }),
      manager,
    );

    expect(
      actions.find((a) => a.code === PetActionCode.INCIDENT_FINE)?.isEnabled,
    ).toBe(true);
    expect(
      actions.find((a) => a.code === PetActionCode.INCIDENT_WARN)?.isEnabled,
    ).toBe(true);
  });

  it('la observación de quien dio curso no abre la sanción', async () => {
    const actions = await actionsFor(
      incidentOf({
        status: PetIncidentStatus.UNDER_DEFENSE,
        unitId: 'unit-1',
        statementDueAt: inDays(3),
        statements: [{ id: 'st-1', isDefense: false }] as never,
      }),
      manager,
    );

    const warn = actions.find((a) => a.code === PetActionCode.INCIDENT_WARN);
    expect(warn?.isEnabled).toBe(false);
    expect(warn?.disabledReason).toContain('plazo');
  });

  it('un caso cerrado no se reabre desde el aviso', async () => {
    const actions = await actionsFor(
      incidentOf({ status: PetIncidentStatus.FINED, unitId: 'unit-1' }),
      manager,
    );

    expect(actions).toEqual([]);
  });
});

describe('PetsNotificationDetailProvider — el residente que recibe el aviso', () => {
  it('la unidad señalada puede presentar descargos', async () => {
    // El servicio ya le borró la identidad de quien reportó: eso es lo que
    // distingue a la unidad acusada de quien puso el reporte.
    const actions = await actionsFor(
      incidentOf({
        status: PetIncidentStatus.UNDER_DEFENSE,
        unitId: 'unit-1',
        statementDueAt: inDays(3),
        reportedByUserId: null,
      }),
      userOf([ValidRoles.RESIDENT_ROL], 'resident-user-1'),
    );

    expect(actions.map((a) => a.code)).toEqual([
      PetActionCode.INCIDENT_STATEMENT,
    ]);
  });

  it('a quien reportó no se le ofrece nada: no tiene qué contestar', async () => {
    const actions = await actionsFor(
      incidentOf({
        status: PetIncidentStatus.UNDER_DEFENSE,
        unitId: 'unit-1',
        statementDueAt: inDays(3),
        reportedByUserId: 'vecino-9',
      }),
      userOf([ValidRoles.RESIDENT_ROL], 'vecino-9'),
    );

    expect(actions).toEqual([]);
  });

  it('vencido el plazo, los descargos quedan apagados con la fecha', async () => {
    const actions = await actionsFor(
      incidentOf({
        status: PetIncidentStatus.UNDER_DEFENSE,
        unitId: 'unit-1',
        statementDueAt: inDays(-1),
        reportedByUserId: null,
      }),
      userOf([ValidRoles.RESIDENT_ROL], 'resident-user-1'),
    );

    expect(actions[0].isEnabled).toBe(false);
    expect(actions[0].disabledReason).toContain('venció');
  });
});

describe('PetsNotificationDetailProvider — ejecutar va contra el servicio', () => {
  const manager = userOf([ValidRoles.COMPLEX_ROL]);

  it('la multa llega al servicio con valor y motivación', async () => {
    const incident = incidentOf({
      status: PetIncidentStatus.UNDER_DEFENSE,
      unitId: 'unit-1',
    });
    const h = buildHarness(incident);

    await h.provider.execute({
      notification: notificationOf(),
      currentUser: manager,
      actionCode: PetActionCode.INCIDENT_FINE,
      values: {
        fineAmount: '50000',
        resolutionNotes: 'Reincidencia comprobada con la evidencia aportada.',
      },
    });

    expect(h.sanction).toHaveBeenCalledWith(
      {
        incidentId: 'incident-1',
        sanction: PetSanction.FINE,
        fineAmount: 50000,
        resolutionNotes: 'Reincidencia comprobada con la evidencia aportada.',
      },
      manager,
    );
  });

  it('un valor de multa que no es número no llega al servicio', async () => {
    const h = buildHarness(incidentOf());

    await expect(
      h.provider.execute({
        notification: notificationOf(),
        currentUser: manager,
        actionCode: PetActionCode.INCIDENT_FINE,
        values: { fineAmount: 'cincuenta mil', resolutionNotes: 'Motivación.' },
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_INPUT' });

    expect(h.sanction).not.toHaveBeenCalled();
  });
});

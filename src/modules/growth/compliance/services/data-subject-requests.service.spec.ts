import { ConfigService } from '@nestjs/config';
import { ValidRoles } from '../../../roles/enums/valid-roles';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { GrowthHashService } from '../../shared/growth-hash.service';
import {
  GrowthDataSubjectRequestStatus as Status,
  GrowthDataSubjectRequestType as RequestType,
  GrowthIdentifierType as T,
  GrowthRequestChannel,
  GrowthSuppressionReason,
} from '../../shared/growth.enums';
import { DataSubjectRequest } from '../entities/data-subject-request.entity';
import { DataSubjectRequestsService } from './data-subject-requests.service';

const actor: JwtAccessPayload = {
  sub: '11111111-1111-1111-1111-111111111111',
  email: 'dpo@alternaqj.com',
  type: 'access',
  entityType: 'user',
  tokenVersion: 1,
  sessionId: 's',
  roles: [ValidRoles.GROWTH_MANAGER_ROL],
  permissions: [],
};

function setup(existing?: Partial<DataSubjectRequest>) {
  const hashes = new GrowthHashService({
    get: (k: string) =>
      k === 'GROWTH_SUPPRESSION_HMAC_KEYS'
        ? `1:${Buffer.alloc(32, 1).toString('base64')}`
        : '1',
  } as unknown as ConfigService);
  const manager = {
    save: jest.fn(async (e: any): Promise<any> => ({ id: 'r1', ...e })),
    create: jest.fn((_: unknown, d: object) => d),
    findOne: jest.fn(async () => (existing ? { ...existing } : null)),
  };
  const dataSource = {
    manager,
    transaction: jest.fn((fn: (m: typeof manager) => unknown) => fn(manager)),
  };
  const suppressions = { addHashed: jest.fn(async () => ({ id: 'supp-1' })) };
  const activity = { record: jest.fn() };
  const service = new DataSubjectRequestsService(
    dataSource as never,
    hashes,
    suppressions as never,
    activity as never,
  );
  return { service, manager, suppressions, activity };
}

const open = (type: RequestType): Partial<DataSubjectRequest> => ({
  id: 'r1',
  requestType: type,
  status: Status.IN_PROGRESS,
  subjectIdentifierType: T.EMAIL,
  subjectKeyVersion: 1,
  subjectIdentifierHash: 'a'.repeat(64),
  subjectContact: 'titular@correo.co',
  dueAt: new Date('2026-11-20T04:59:59.999Z'),
});

describe('DataSubjectRequestsService', () => {
  it('guarda el titular solo como hash y calcula el plazo legal', async () => {
    const { service, manager } = setup();
    await service.create(
      {
        requestType: RequestType.ACCESS,
        channel: GrowthRequestChannel.EMAIL,
        identifierType: T.EMAIL,
        identifierValue: 'Titular@Correo.co',
        receivedAt: new Date('2026-10-30T20:00:00Z'),
      },
      actor,
    );
    const saved = manager.save.mock.calls[0][0];
    expect(saved.subjectIdentifierHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(saved)).not.toMatch(/titular@correo/i);
    expect(saved.dueAt.toISOString()).toBe('2026-11-18T04:59:59.999Z'); // 10 días hábiles
  });

  it('no acepta una fecha de recepción futura', async () => {
    const { service } = setup();
    await expect(
      service.create(
        {
          requestType: RequestType.ACCESS,
          channel: GrowthRequestChannel.EMAIL,
          identifierType: T.EMAIL,
          identifierValue: 'a@b.co',
          receivedAt: new Date(Date.now() + 86_400_000),
        },
        actor,
      ),
    ).rejects.toThrow('futura');
  });

  it.each([
    RequestType.DELETION,
    RequestType.REVOCATION,
    RequestType.OBJECTION,
  ])(
    '%s resuelta agrega al titular a la lista de exclusión y borra su contacto',
    async (type) => {
      const { service, suppressions, manager } = setup(open(type));
      await service.close(
        'r1',
        {
          outcome: Status.RESOLVED,
          resolutionNotes: 'Atendida dentro del plazo',
        },
        actor,
      );
      expect(suppressions.addHashed).toHaveBeenCalledWith(
        manager,
        actor,
        expect.objectContaining({
          reason: GrowthSuppressionReason.SUBJECT_REQUEST,
          sourceRequestId: 'r1',
          writeHash: { keyVersion: 1, hash: 'a'.repeat(64) },
        }),
      );
      const saved = manager.save.mock.calls.at(-1)[0];
      expect(saved.subjectContact).toBeNull();
      expect(saved.contactRedactedAt).toBeInstanceOf(Date);
    },
  );

  it('una consulta resuelta o una solicitud rechazada no tocan la lista de exclusión', async () => {
    const a = setup(open(RequestType.ACCESS));
    await a.service.close(
      'r1',
      { outcome: Status.RESOLVED, resolutionNotes: 'Información entregada' },
      actor,
    );
    expect(a.suppressions.addHashed).not.toHaveBeenCalled();

    const b = setup(open(RequestType.DELETION));
    await b.service.close(
      'r1',
      { outcome: Status.REJECTED, resolutionNotes: 'Titular no acreditado' },
      actor,
    );
    expect(b.suppressions.addHashed).not.toHaveBeenCalled();
  });

  it('ninguna transición permite cerrar dos veces', async () => {
    const { service } = setup({
      ...open(RequestType.DELETION),
      status: Status.RESOLVED,
    });
    await expect(
      service.close(
        'r1',
        { outcome: Status.RESOLVED, resolutionNotes: 'Otra vez cerrada' },
        actor,
      ),
    ).rejects.toThrow('estado RESOLVED');
  });

  it('la prórroga suma 8 días hábiles a un reclamo', async () => {
    const { service, manager } = setup(open(RequestType.DELETION));
    await service.extend(
      'r1',
      { reason: 'Requiere verificar con la fuente' },
      actor,
    );
    const saved = manager.save.mock.calls.at(-1)[0];
    expect(saved.status).toBe(Status.EXTENDED);
    // 19-nov (jue) + 8 hábiles = 1-dic (mar).
    expect(saved.extendedDueAt.toISOString()).toBe('2026-12-02T04:59:59.999Z');
  });
});

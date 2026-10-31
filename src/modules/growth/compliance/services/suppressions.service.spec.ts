import { ConfigService } from '@nestjs/config';
import { ValidRoles } from '../../../roles/enums/valid-roles';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { GrowthHashService } from '../../shared/growth-hash.service';
import {
  GrowthIdentifierType as T,
  GrowthSuppressionReason,
  GrowthSuppressionScope as Scope,
  GrowthSuppressionStatus,
} from '../../shared/growth.enums';
import { Suppression } from '../entities/suppression.entity';
import { SuppressionHash } from '../entities/suppression-hash.entity';
import { SuppressionsService } from './suppressions.service';

const KEY_1 = Buffer.alloc(32, 1).toString('base64');
const KEY_2 = Buffer.alloc(32, 2).toString('base64');

const actor: JwtAccessPayload = {
  sub: '11111111-1111-1111-1111-111111111111',
  email: 'compliance@alternaqj.com',
  type: 'access',
  entityType: 'user',
  tokenVersion: 1,
  sessionId: 's',
  roles: [ValidRoles.COMPILANCE_OFFICER_ROL],
  permissions: [],
};

function setup(opts: {
  keys?: string;
  active?: number;
  matches?: Array<{ id: string; scope: Scope; versions: number[] }>;
  uncovered?: number;
  existing?: Partial<Suppression> | null;
}) {
  const hashes = new GrowthHashService({
    get: (k: string) =>
      k === 'GROWTH_SUPPRESSION_HMAC_KEYS'
        ? (opts.keys ?? `1:${KEY_1}`)
        : String(opts.active ?? 1),
  } as unknown as ConfigService);

  const inserted: Array<{ entity: unknown; values: unknown }> = [];
  const updated: Array<{ id: string; values: Record<string, unknown> }> = [];
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('pg_advisory_xact_lock')) return [];
    if (sql.includes('active_suppressions')) {
      return [
        {
          active_suppressions: 1,
          missing_active: 0,
          uncovered: opts.uncovered ?? 0,
        },
      ];
    }
    if (sql.includes('count(*)::int AS n')) return [{ n: 0 }];
    return opts.matches ?? [];
  });
  const manager = {
    query,
    save: jest.fn(async (e: Partial<Suppression>) => ({
      id: 'new-supp',
      ...e,
    })),
    create: jest.fn((_: unknown, data: object) => data),
    insert: jest.fn(async (entity: unknown, values: unknown) => {
      inserted.push({ entity, values });
    }),
    update: jest.fn(
      async (_: unknown, id: string, values: Record<string, unknown>) => {
        updated.push({ id, values });
      },
    ),
    findOne: jest.fn(async () => opts.existing ?? null),
    findOneOrFail: jest.fn(
      async (_: unknown, o: { where: { id: string } }) => ({
        id: o.where.id,
        status: GrowthSuppressionStatus.LIFTED,
      }),
    ),
  };
  const qbInsert = {
    into: jest.fn(),
    values: jest.fn(),
    orIgnore: jest.fn(),
    execute: jest.fn(),
  };
  qbInsert.into.mockReturnValue(qbInsert);
  qbInsert.values.mockImplementation((v: unknown) => {
    inserted.push({ entity: SuppressionHash, values: v });
    return qbInsert;
  });
  qbInsert.orIgnore.mockReturnValue(qbInsert);
  const dataSource = {
    manager,
    query,
    transaction: jest.fn((fn: (m: typeof manager) => unknown) => fn(manager)),
    createQueryBuilder: () => ({ insert: () => qbInsert }),
  };
  const activity = { record: jest.fn() };
  const service = new SuppressionsService(
    dataSource as never,
    hashes,
    activity as never,
  );
  return { service, manager, inserted, updated, activity, hashes };
}

describe('SuppressionsService', () => {
  describe('isSuppressed', () => {
    it('bloquea si hay una exclusión activa para todos los canales', async () => {
      const { service } = setup({
        matches: [{ id: 's1', scope: Scope.ALL_CHANNELS, versions: [1] }],
      });
      await expect(
        service.isSuppressed({
          identifierType: T.EMAIL,
          value: 'a@b.co',
          channel: Scope.EMAIL,
        }),
      ).resolves.toBe(true);
    });

    it('una exclusión solo de WhatsApp no bloquea el correo', async () => {
      const { service } = setup({
        matches: [{ id: 's1', scope: Scope.WHATSAPP, versions: [1] }],
      });
      await expect(
        service.isSuppressed({
          identifierType: T.EMAIL,
          value: 'a@b.co',
          channel: Scope.EMAIL,
        }),
      ).resolves.toBe(false);
      // Sin canal: cualquier exclusión activa bloquea.
      await expect(
        service.isSuppressed({ identifierType: T.EMAIL, value: 'a@b.co' }),
      ).resolves.toBe(true);
    });

    it('rotación: una exclusión con llave vieja sigue bloqueando y recibe el hash de la activa', async () => {
      const { service, inserted, hashes } = setup({
        keys: `1:${KEY_1},2:${KEY_2}`,
        active: 2,
        matches: [{ id: 's-old', scope: Scope.ALL_CHANNELS, versions: [1] }],
      });
      await expect(
        service.isSuppressed({ identifierType: T.EMAIL, value: 'A@B.co' }),
      ).resolves.toBe(true);
      expect(inserted).toEqual([
        {
          entity: SuppressionHash,
          values: {
            suppressionId: 's-old',
            identifierType: T.EMAIL,
            keyVersion: 2,
            identifierHash: hashes.hashActive(T.EMAIL, 'a@b.co').hash,
          },
        },
      ]);
    });

    it('falla cerrada: si alguna exclusión quedó sin llave, la consulta NO responde "no excluido"', async () => {
      const { service } = setup({ uncovered: 3 });
      await expect(
        service.isSuppressed({ identifierType: T.EMAIL, value: 'a@b.co' }),
      ).rejects.toThrow('no se puede verificar');
    });
  });

  describe('add', () => {
    it('guarda solo el hash, nunca el dato en claro', async () => {
      const { service, inserted, manager } = setup({});
      await service.add(
        {
          identifierType: T.EMAIL,
          value: 'Persona@Correo.co',
          scope: Scope.ALL_CHANNELS,
          reason: GrowthSuppressionReason.UNSUBSCRIBE,
        },
        actor,
      );
      const persisted = JSON.stringify([manager.save.mock.calls, inserted]);
      expect(persisted).not.toMatch(/persona@correo\.co/i);
      expect(inserted[0].values).toMatchObject({
        keyVersion: 1,
        identifierType: T.EMAIL,
      });
    });

    it('si ya estaba excluido devuelve la exclusión existente sin duplicar', async () => {
      const { service, manager, activity } = setup({
        matches: [{ id: 's1', scope: Scope.ALL_CHANNELS, versions: [1] }],
      });
      await service.add(
        {
          identifierType: T.EMAIL,
          value: 'a@b.co',
          scope: Scope.EMAIL,
          reason: GrowthSuppressionReason.UNSUBSCRIBE,
        },
        actor,
      );
      expect(manager.save).not.toHaveBeenCalled();
      expect(activity.record).not.toHaveBeenCalled();
    });

    it('registra la actividad sin datos personales', async () => {
      const { service, activity } = setup({});
      await service.add(
        {
          identifierType: T.PHONE,
          value: '3001234567',
          scope: Scope.ALL_CHANNELS,
          reason: GrowthSuppressionReason.COMPLAINT,
        },
        actor,
      );
      const [, , event] = activity.record.mock.calls[0];
      expect(event.action).toBe('SUPPRESSION_ADDED');
      expect(JSON.stringify(event)).not.toContain('3001234567');
    });
  });

  describe('lift', () => {
    it('levanta solo una exclusión activa y deja fundamento y soporte', async () => {
      const { service, updated, activity } = setup({
        existing: { id: 's1', status: GrowthSuppressionStatus.ACTIVE },
      });
      await service.lift(
        's1',
        {
          legalBasis: 'Autorización escrita del titular',
          evidenceReference: 'RAD-2026-001',
        },
        actor,
      );
      expect(updated).toHaveLength(1);
      expect(Object.keys(updated[0].values).sort()).toEqual(
        [
          'liftEvidenceReference',
          'liftLegalBasis',
          'liftedAt',
          'liftedByUserId',
          'status',
        ].sort(),
      );
      expect(activity.record.mock.calls[0][2].action).toBe(
        'SUPPRESSION_LIFTED',
      );
    });

    it('no reactiva ni vuelve a levantar una exclusión ya levantada', async () => {
      const { service, updated } = setup({
        existing: { id: 's1', status: GrowthSuppressionStatus.LIFTED },
      });
      await expect(
        service.lift(
          's1',
          {
            legalBasis: 'Autorización escrita del titular',
            evidenceReference: 'RAD-1',
          },
          actor,
        ),
      ).rejects.toThrow('ya fue levantada');
      expect(updated).toEqual([]);
    });
  });
});

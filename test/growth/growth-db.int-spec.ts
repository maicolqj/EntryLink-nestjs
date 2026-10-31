/**
 * Integración de la Growth Suite contra un Postgres REAL con las migraciones
 * aplicadas. Verifica que la integridad la impone la base (triggers y CHECK),
 * no solo la aplicación, y que las entidades calzan con las tablas.
 *
 * NUNCA apuntar a producción ni a la base de desarrollo: usa una base
 * desechable. Sin GROWTH_IT_DATABASE_URL la suite se omite.
 *
 *   GROWTH_IT_DATABASE_URL=postgres://postgres:***@127.0.0.1:55432/growth_test \
 *     yarn test:growth:int
 *
 * Ver docs/growth/TESTING.md para preparar la base.
 */
import 'reflect-metadata';
import { resetGrowthTestData } from './db-cleanup';
import { GROWTH_PERMISSIONS } from '../../src/modules/growth/shared/growth-access.catalog';
import { ConfigService } from '@nestjs/config';
import { DataSource, QueryFailedError } from 'typeorm';
import { ValidRoles } from '../../src/modules/roles/enums/valid-roles';
import { JwtAccessPayload } from '../../src/modules/shared/interfaces/jwt-payload.interface';
import { ActivityEvent } from '../../src/modules/growth/activity/entities/activity-event.entity';
import { ActivityLogService } from '../../src/modules/growth/activity/services/activity-log.service';
import { DataSubjectRequest } from '../../src/modules/growth/compliance/entities/data-subject-request.entity';
import { LegalHold } from '../../src/modules/growth/compliance/entities/legal-hold.entity';
import { Suppression } from '../../src/modules/growth/compliance/entities/suppression.entity';
import { SuppressionHash } from '../../src/modules/growth/compliance/entities/suppression-hash.entity';
import { DataSubjectRequestsService } from '../../src/modules/growth/compliance/services/data-subject-requests.service';
import { LegalHoldsService } from '../../src/modules/growth/compliance/services/legal-holds.service';
import { SuppressionsService } from '../../src/modules/growth/compliance/services/suppressions.service';
import { GrowthHashService } from '../../src/modules/growth/shared/growth-hash.service';
import {
  GrowthDataSubjectRequestStatus as DsrStatus,
  GrowthDataSubjectRequestType as DsrType,
  GrowthEntityType,
  GrowthIdentifierType as T,
  GrowthLegalReviewStatus,
  GrowthRequestChannel,
  GrowthSourceStatus,
  GrowthSuppressionReason,
  GrowthSuppressionScope as Scope,
} from '../../src/modules/growth/shared/growth.enums';
import { IdentityDirectoryService } from '../../src/modules/growth/shared/identity-directory.service';
import { GrowthDataSource } from '../../src/modules/growth/sources/entities/growth-data-source.entity';
import { DataSourcesService } from '../../src/modules/growth/sources/services/data-sources.service';
import { TeamMember } from '../../src/modules/growth/team/entities/team-member.entity';
import { TeamMembersService } from '../../src/modules/growth/team/services/team-members.service';

const URL = process.env.GROWTH_IT_DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

const KEY_1 = Buffer.alloc(32, 7).toString('base64');
const KEY_2 = Buffer.alloc(32, 8).toString('base64');

const SALES_USER = 'aaaaaaaa-0000-4000-8000-000000000001';
const COMPLEX_USER = 'aaaaaaaa-0000-4000-8000-000000000002';
const ADMIN_USER = 'aaaaaaaa-0000-4000-8000-000000000003';
const FAKE_COMPLEX = 'aaaaaaaa-0000-4000-8000-0000000000cc';

const admin: JwtAccessPayload = {
  sub: ADMIN_USER,
  email: 'admin@alternaqj.com',
  type: 'access',
  entityType: 'user',
  tokenVersion: 1,
  sessionId: 's',
  roles: [ValidRoles.SUPER_ADMIN_ROL],
  permissions: [],
};

const hashService = (keys: string, active: number) =>
  new GrowthHashService({
    get: (k: string) =>
      k === 'GROWTH_SUPPRESSION_HMAC_KEYS' ? keys : String(active),
  } as unknown as ConfigService);

async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  await expect(promise).rejects.toBeInstanceOf(QueryFailedError);
  await expect(promise).rejects.toThrow(pattern);
}

describeDb('Growth Suite — base de datos real', () => {
  let ds: DataSource;
  let activity: ActivityLogService;
  let suppressions: SuppressionsService;

  const build = (hashes: GrowthHashService) => {
    const s = new SuppressionsService(ds, hashes, activity);
    return {
      suppressions: s,
      requests: new DataSubjectRequestsService(ds, hashes, s, activity),
    };
  };

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      url: URL,
      entities: [
        TeamMember,
        ActivityEvent,
        GrowthDataSource,
        Suppression,
        SuppressionHash,
        DataSubjectRequest,
        LegalHold,
      ],
      synchronize: false,
    });
    await ds.initialize();

    // Salvavidas: esta suite solo corre contra una base desechable.
    const [{ db }] = await ds.query('SELECT current_database() AS db');
    if (!/test/i.test(db))
      throw new Error(`Base "${db}" no parece de prueba: abortado`);

    // Ambas suites comparten la base: se limpian también las tablas de 1A.
    await resetGrowthTestData(ds, ['aaaaaaaa-', 'bbbbbbbb-']);

    for (const [id, email, phone, complexId] of [
      [SALES_USER, 'ventas@alternaqj.com', '3009990001', null],
      [COMPLEX_USER, 'portero@conjunto.co', '3009990002', FAKE_COMPLEX],
      [ADMIN_USER, 'admin@alternaqj.com', '3009990003', null],
    ]) {
      await ds.query(
        `INSERT INTO public.users (id, name, last_name, number_phone, email, password, complex_id)
         VALUES ($1, 'Prueba', 'Growth', $3, $2, 'x', $4)`,
        [id, email, phone, complexId],
      );
    }
    await ds.query(
      `INSERT INTO public.user_has_roles (user_id, role_id)
       SELECT $1, id FROM public.roles WHERE name = 'SALES_ROL'`,
      [SALES_USER],
    );
    await ds.query(
      `INSERT INTO public.user_has_roles (user_id, role_id)
       SELECT $1, id FROM public.roles WHERE name = 'SALES_ROL'`,
      [COMPLEX_USER],
    );

    activity = new ActivityLogService(ds.getRepository(ActivityEvent));
    suppressions = build(hashService(`1:${KEY_1}`, 1)).suppressions;
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  describe('roles y permisos de la migración', () => {
    it('los roles y permisos de la suite existen inactivos', async () => {
      const roles = await ds.query(
        `SELECT name::text, status FROM public.roles WHERE name::text IN ('GROWTH_MANAGER_ROL','SALES_ROL','GROWTH_RESEARCHER_ROL')`,
      );
      expect(roles).toHaveLength(3);
      expect(roles.every((r: { status: boolean }) => r.status === false)).toBe(
        true,
      );
      const [perms] = await ds.query(
        `SELECT count(*)::int AS n, bool_or(status) AS any_active FROM public.permissions WHERE "group" = 'GROWTH'`,
      );
      expect(perms).toEqual({
        n: GROWTH_PERMISSIONS.length,
        any_active: false,
      });
    });

    it('ningún rol fuera de la suite recibe permisos GROWTH en la migración', async () => {
      const [row] = await ds.query(
        `SELECT count(*)::int AS n FROM public.role_permissions rp
           JOIN public.roles r ON r.id = rp.role_id
           JOIN public.permissions p ON p.id = rp.permission_id
          WHERE p."group" = 'GROWTH'
            AND r.name::text NOT IN ('GROWTH_MANAGER_ROL','SALES_ROL','GROWTH_RESEARCHER_ROL')`,
      );
      expect(row.n).toBe(0);
    });
  });

  describe('aislamiento', () => {
    it('las únicas FK que salen del esquema growth apuntan a public.users', async () => {
      const rows = await ds.query(
        `SELECT DISTINCT confrelid::regclass::text AS target FROM pg_constraint
          WHERE contype = 'f' AND connamespace = 'growth'::regnamespace
            AND confrelid::regclass::text NOT LIKE 'growth.%'`,
      );
      expect(rows.map((r: { target: string }) => r.target)).toEqual(['users']);
    });

    it('ninguna tabla de public apunta a growth', async () => {
      const [row] = await ds.query(
        `SELECT count(*)::int AS n FROM pg_constraint
          WHERE contype = 'f' AND connamespace = 'public'::regnamespace
            AND confrelid::regclass::text LIKE 'growth.%'`,
      );
      expect(row.n).toBe(0);
    });
  });

  describe('registro de actividad append-only (trigger)', () => {
    let eventId: string;
    beforeAll(async () => {
      await ds.transaction((m) =>
        activity.record(m, admin, {
          action: 'TEST_EVENT',
          entityType: GrowthEntityType.TEAM_MEMBER,
          entityId: SALES_USER,
        }),
      );
      [{ id: eventId }] = await ds.query(
        `SELECT id FROM growth.activity_events WHERE action = 'TEST_EVENT'`,
      );
    });

    it('UPDATE rechazado', async () => {
      await expectDbError(
        ds.query(
          `UPDATE growth.activity_events SET action = 'X_X' WHERE id = $1`,
          [eventId],
        ),
        /append-only/,
      );
    });
    it('DELETE rechazado', async () => {
      await expectDbError(
        ds.query(`DELETE FROM growth.activity_events WHERE id = $1`, [eventId]),
        /append-only/,
      );
    });
    it('TRUNCATE rechazado', async () => {
      await expectDbError(
        ds.query(`TRUNCATE growth.activity_events`),
        /append-only/,
      );
    });
    it('tampoco por el repositorio de TypeORM', async () => {
      await expect(
        ds.getRepository(ActivityEvent).delete({ id: eventId }),
      ).rejects.toThrow(/append-only/);
      await expect(
        ds
          .getRepository(ActivityEvent)
          .update({ id: eventId }, { action: 'OTRA_COSA' }),
      ).rejects.toThrow(/append-only/);
    });
  });

  describe('lista de exclusión', () => {
    let suppressionId: string;

    beforeAll(async () => {
      const s = await suppressions.add(
        {
          identifierType: T.EMAIL,
          value: 'NoContactar@Empresa.co',
          scope: Scope.ALL_CHANNELS,
          reason: GrowthSuppressionReason.UNSUBSCRIBE,
        },
        admin,
      );
      suppressionId = s.id;
    });

    it('no guarda el dato en claro en ninguna tabla de la suite', async () => {
      const [row] = await ds.query(
        `SELECT
           (SELECT count(*) FROM growth.suppressions s WHERE s::text ILIKE '%nocontactar%')
         + (SELECT count(*) FROM growth.suppression_hashes h WHERE h::text ILIKE '%nocontactar%')
         + (SELECT count(*) FROM growth.activity_events e WHERE e::text ILIKE '%nocontactar%') AS n`,
      );
      expect(Number(row.n)).toBe(0);
    });

    it('bloquea el dato aunque se escriba distinto', async () => {
      await expect(
        suppressions.isSuppressed({
          identifierType: T.EMAIL,
          value: ' nocontactar@EMPRESA.co',
        }),
      ).resolves.toBe(true);
      await expect(
        suppressions.isSuppressed({
          identifierType: T.EMAIL,
          value: 'otra@empresa.co',
        }),
      ).resolves.toBe(false);
    });

    it('DELETE y TRUNCATE rechazados', async () => {
      await expectDbError(
        ds.query(`DELETE FROM growth.suppressions WHERE id = $1`, [
          suppressionId,
        ]),
        /append-only/,
      );
      await expectDbError(
        ds.query(`TRUNCATE growth.suppressions CASCADE`),
        /append-only/,
      );
      await expectDbError(
        ds.query(
          `DELETE FROM growth.suppression_hashes WHERE suppression_id = $1`,
          [suppressionId],
        ),
        /append-only/,
      );
      await expectDbError(
        ds.query(
          `UPDATE growth.suppression_hashes SET key_version = 9 WHERE suppression_id = $1`,
          [suppressionId],
        ),
        /append-only/,
      );
    });

    it('no se puede editar ni "levantar a medias" por SQL directo', async () => {
      await expectDbError(
        ds.query(
          `UPDATE growth.suppressions SET scope = 'EMAIL' WHERE id = $1`,
          [suppressionId],
        ),
        /solo se permite levantar/,
      );
      await expectDbError(
        ds.query(
          `UPDATE growth.suppressions SET status = 'LIFTED' WHERE id = $1`,
          [suppressionId],
        ),
        /ck_growth_suppressions_lift/,
      );
      await expectDbError(
        ds.query(
          `UPDATE growth.suppressions SET status = 'LIFTED', lifted_at = now(), lifted_by_user_id = $2,
                  lift_legal_basis = 'corto', lift_evidence_reference = 'RAD-1' WHERE id = $1`,
          [suppressionId, ADMIN_USER],
        ),
        /ck_growth_suppressions_lift/,
      );
    });

    it('levantar con soporte funciona, queda en el historial y no se puede revertir', async () => {
      const lifted = await suppressions.lift(
        suppressionId,
        {
          legalBasis: 'Autorización expresa y escrita del titular',
          evidenceReference: 'RAD-2026-0001',
        },
        admin,
      );
      expect(lifted.status).toBe('LIFTED');
      await expect(
        suppressions.isSuppressed({
          identifierType: T.EMAIL,
          value: 'nocontactar@empresa.co',
        }),
      ).resolves.toBe(false);
      await expectDbError(
        ds.query(
          `UPDATE growth.suppressions SET status = 'ACTIVE' WHERE id = $1`,
          [suppressionId],
        ),
        /solo se permite levantar/,
      );
      const [ev] = await ds.query(
        `SELECT count(*)::int AS n FROM growth.activity_events WHERE entity_id = $1 AND action = 'SUPPRESSION_LIFTED'`,
        [suppressionId],
      );
      expect(ev.n).toBe(1);
    });

    it('rotación de llave: la exclusión hecha con v1 bloquea con v1+v2 y recibe hash v2', async () => {
      await suppressions.add(
        {
          identifierType: T.PHONE,
          value: '300 555 0101',
          scope: Scope.ALL_CHANNELS,
          reason: GrowthSuppressionReason.COMPLAINT,
        },
        admin,
      );
      const rotated = build(
        hashService(`1:${KEY_1},2:${KEY_2}`, 2),
      ).suppressions;
      const before = await rotated.keyStatus();
      expect(before.missingActiveVersion).toBeGreaterThan(0);
      expect(before.retirableVersions).toEqual([]);

      await expect(
        rotated.isSuppressed({
          identifierType: T.PHONE,
          value: '+573005550101',
        }),
      ).resolves.toBe(true);
      const [h] = await ds.query(
        `SELECT array_agg(key_version ORDER BY key_version) AS v FROM growth.suppression_hashes h
           JOIN growth.suppressions s ON s.id = h.suppression_id
          WHERE s.identifier_type = 'PHONE' AND s.status = 'ACTIVE'`,
      );
      expect(h.v).toEqual([1, 2]);
    });

    it('falla cerrada si se retira una llave de la que aún dependen exclusiones', async () => {
      // Exclusión nueva con hash solo en v1 (nadie la ha consultado con v2).
      await suppressions.add(
        {
          identifierType: T.NIT,
          value: '900.123.456-7',
          scope: Scope.ALL_CHANNELS,
          reason: GrowthSuppressionReason.INTERNAL,
        },
        admin,
      );
      const onlyV2 = build(hashService(`2:${KEY_2}`, 2)).suppressions;
      const status = await onlyV2.keyStatus();
      expect(status.uncovered).toBeGreaterThan(0);
      await expect(
        onlyV2.isSuppressed({ identifierType: T.EMAIL, value: 'x@y.co' }),
      ).rejects.toThrow('no se puede verificar');
    });
  });

  describe('solicitudes de titulares', () => {
    it('una supresión resuelta agrega la exclusión y borra el contacto, en la misma transacción', async () => {
      const { requests } = build(hashService(`1:${KEY_1}`, 1));
      const r = await requests.create(
        {
          requestType: DsrType.DELETION,
          channel: GrowthRequestChannel.EMAIL,
          identifierType: T.EMAIL,
          identifierValue: 'titular@empresa.co',
          subjectContact: 'titular@empresa.co',
        },
        admin,
      );
      await requests.start(r.id, admin);
      const closed = await requests.close(
        r.id,
        {
          outcome: DsrStatus.RESOLVED,
          resolutionNotes: 'Datos suprimidos y titular excluido',
        },
        admin,
      );
      expect(closed.subjectContact).toBeNull();
      await expect(
        suppressions.isSuppressed({
          identifierType: T.EMAIL,
          value: 'titular@empresa.co',
        }),
      ).resolves.toBe(true);
      const [s] = await ds.query(
        `SELECT reason, source_request_id FROM growth.suppressions WHERE source_request_id = $1`,
        [r.id],
      );
      expect(s.reason).toBe('SUBJECT_REQUEST');
    });

    it('la base exige notas y responsable al cerrar', async () => {
      const [{ id }] = await ds.query(
        `INSERT INTO growth.data_subject_requests (request_type, channel, subject_identifier_type, subject_key_version, subject_identifier_hash, received_at, due_at)
         VALUES ('ACCESS','EMAIL','EMAIL',1,$1, now(), now() + interval '10 days') RETURNING id`,
        ['b'.repeat(64)],
      );
      await expectDbError(
        ds.query(
          `UPDATE growth.data_subject_requests SET status = 'RESOLVED', resolved_at = now() WHERE id = $1`,
          [id],
        ),
        /ck_growth_dsr_closed_notes/,
      );
    });
  });

  describe('fuentes', () => {
    it('la base no deja activar una fuente sin revisión jurídica, aunque se salte el servicio', async () => {
      await expectDbError(
        ds.query(
          `UPDATE growth.data_sources SET status = 'ACTIVE' WHERE code = 'RUES'`,
        ),
        /ck_growth_sources_active_legal/,
      );
    });

    it('ni una de pago sin presupuesto aprobado', async () => {
      await expectDbError(
        ds.query(
          `UPDATE growth.data_sources SET legal_review_status = 'APPROVED', legal_review_reference = 'x',
                  legal_reviewed_at = now(), legal_reviewed_by_user_id = $1, status = 'ACTIVE'
            WHERE code = 'GOOGLE_PLACES'`,
          [ADMIN_USER],
        ),
        /ck_growth_sources_active_cost/,
      );
    });

    it('el flujo del servicio: revisión → costo → activación, con actividad', async () => {
      const service = new DataSourcesService(
        ds.getRepository(GrowthDataSource),
        ds,
        activity,
      );
      const [{ id }] = await ds.query(
        `SELECT id FROM growth.data_sources WHERE code = 'GOOGLE_PLACES'`,
      );
      await service.reviewLegal(
        id,
        {
          decision: GrowthLegalReviewStatus.APPROVED,
          reference: 'Concepto jurídico IT',
        },
        admin,
      );
      await expect(
        service.setStatus(id, { status: GrowthSourceStatus.ACTIVE }, admin),
      ).rejects.toThrow('aprobación de costo');
      await service.approveCost(
        id,
        {
          monthlyBudgetCop: 100000,
          monthlyRequestCap: 1000,
          costEstimateNotes: 'Prueba de integración del flujo',
        },
        admin,
      );
      const active = await service.setStatus(
        id,
        { status: GrowthSourceStatus.ACTIVE },
        admin,
      );
      expect(active.status).toBe('ACTIVE');
      // Redefinir la fuente la saca de servicio.
      const redefined = await service.update(
        id,
        {
          termsSummary: `Términos nuevos que cambian el alcance del uso (${Date.now()})`,
        },
        admin,
      );
      expect(redefined.status).toBe('PENDING_APPROVAL');
      expect(redefined.costApprovedAt).toBeNull();
    });
  });

  describe('equipo y retenciones', () => {
    const team = () =>
      new TeamMembersService(
        ds.getRepository(TeamMember),
        ds,
        new IdentityDirectoryService(ds),
        activity,
      );

    it('agrega al usuario comercial y rechaza al ligado a un conjunto', async () => {
      const m = await team().add(
        {
          userId: SALES_USER,
          displayName: 'Ventas Prueba',
          territories: ['Usaquén'],
        },
        admin,
      );
      expect(m.status).toBe('ACTIVE');
      await expect(
        team().add({ userId: COMPLEX_USER, displayName: 'Portero' }, admin),
      ).rejects.toThrow('sin vínculo');
    });

    it('la base impide un integrante duplicado y la baja sin fecha', async () => {
      await expectDbError(
        ds.query(
          `INSERT INTO growth.team_members (user_id, display_name) VALUES ($1, 'Dup')`,
          [SALES_USER],
        ),
        /uq_growth_team_members_user/,
      );
      await expectDbError(
        ds.query(
          `UPDATE growth.team_members SET status = 'INACTIVE' WHERE user_id = $1`,
          [SALES_USER],
        ),
        /ck_growth_team_members_inactive/,
      );
    });

    it('retención legal: entidad existente, fecha finita, máximo 10 años (servicio y base)', async () => {
      const holds = new LegalHoldsService(ds, activity);
      const [{ id }] = await ds.query(
        `SELECT id FROM growth.team_members WHERE user_id = $1`,
        [SALES_USER],
      );
      const nextYear = `${new Date().getUTCFullYear() + 1}-01-15`;
      const hold = await holds.create(
        {
          entityType: GrowthEntityType.TEAM_MEMBER,
          entityId: id,
          legalBasis: 'Conservación por proceso judicial en curso',
          holdUntil: nextYear,
        },
        admin,
      );
      expect(hold.holdUntil).toBe(nextYear);
      await expect(
        holds.create(
          {
            entityType: GrowthEntityType.TEAM_MEMBER,
            entityId: id,
            legalBasis: 'Plazo demasiado largo',
            holdUntil: '2099-01-01',
          },
          admin,
        ),
      ).rejects.toThrow('máximo 10 años');
      await expectDbError(
        ds.query(
          `INSERT INTO growth.legal_holds (entity_type, entity_id, legal_basis, hold_until, created_by_user_id)
           VALUES ('TEAM_MEMBER', $1, 'Saltándose el servicio', '2099-01-01', $2)`,
          [id, ADMIN_USER],
        ),
        /ck_growth_holds_until/,
      );
    });
  });
});

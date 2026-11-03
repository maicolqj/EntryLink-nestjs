/**
 * Integración de 1E-C-0 (versiones de scoring con aprobación) contra
 * Postgres real. Ver docs/growth/TESTING.md. Las pruebas corren en orden:
 * cada una deja la versión activa que usa la siguiente.
 */
import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { DataSource, QueryFailedError } from 'typeorm';
import { ValidPermissions as P } from '../../src/modules/permissions/enums/valid-permissions';
import { ValidRoles } from '../../src/modules/roles/enums/valid-roles';
import { JwtAccessPayload } from '../../src/modules/shared/interfaces/jwt-payload.interface';
import { ActivityEvent } from '../../src/modules/growth/activity/entities/activity-event.entity';
import { ActivityLogService } from '../../src/modules/growth/activity/services/activity-log.service';
import { Suppression } from '../../src/modules/growth/compliance/entities/suppression.entity';
import { SuppressionHash } from '../../src/modules/growth/compliance/entities/suppression-hash.entity';
import { SuppressionsService } from '../../src/modules/growth/compliance/services/suppressions.service';
import { GrowthHashService } from '../../src/modules/growth/shared/growth-hash.service';
import { GrowthDataSource } from '../../src/modules/growth/sources/entities/growth-data-source.entity';
import { TeamMember } from '../../src/modules/growth/team/entities/team-member.entity';
import {
  OrganizationChannel,
  PersonChannel,
} from '../../src/modules/growth/prospects/entities/channels.entity';
import {
  Employment,
  PropertyManagement,
} from '../../src/modules/growth/prospects/entities/relations.entity';
import { Evidence } from '../../src/modules/growth/prospects/entities/evidence.entity';
import { GrowthSettings } from '../../src/modules/growth/prospects/entities/growth-settings.entity';
import { Organization } from '../../src/modules/growth/prospects/entities/organization.entity';
import { Person } from '../../src/modules/growth/prospects/entities/person.entity';
import { Property } from '../../src/modules/growth/prospects/entities/property.entity';
import { ProspectAssignment } from '../../src/modules/growth/prospects/entities/prospect-assignment.entity';
import {
  DuplicateCandidate,
  MergeLog,
  ProspectScore,
  ScoringRule,
} from '../../src/modules/growth/prospects/entities/dedupe-scoring.entity';
import {
  ProspectScoreHistory,
  ScoringVersion,
} from '../../src/modules/growth/prospects/entities/scoring-version.entity';
import {
  GrowthChannelKind,
  GrowthEvidenceReliability,
  GrowthInterestSignal,
  GrowthPriority,
  GrowthProspectKind as K,
  GrowthScoringVersionOrigin,
  GrowthScoringVersionStatus as Status,
} from '../../src/modules/growth/prospects/prospects.enums';
import { ChannelsService } from '../../src/modules/growth/prospects/services/channels.service';
import { EvidencesService } from '../../src/modules/growth/prospects/services/evidences.service';
import { OrganizationsService } from '../../src/modules/growth/prospects/services/organizations.service';
import { PeopleService } from '../../src/modules/growth/prospects/services/people.service';
import { ProspectGuardsService } from '../../src/modules/growth/prospects/services/prospect-guards.service';
import { ScoringCatchupService } from '../../src/modules/growth/prospects/services/scoring-catchup.service';
import { ScoringService } from '../../src/modules/growth/prospects/services/scoring.service';
import { ScoringSimulationService } from '../../src/modules/growth/prospects/services/scoring-simulation.service';
import { ScoringVersionsService } from '../../src/modules/growth/prospects/services/scoring-versions.service';
import { SEED_SCORING_RULES } from '../../src/core/database/migrations/1781010800000-CreateGrowthDedupeAndScoring';
import { resetGrowthTestData } from './db-cleanup';

const URL = process.env.GROWTH_IT_DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

const ID = (n: number) => `eeeeeeee-0000-4000-8000-00000000000${n}`;
const ADMIN = ID(1);
const MANAGER = ID(2);
const EDITOR = ID(3);
const APPROVER = ID(4);
const DUAL = ID(5);

const actor = (
  sub: string,
  roles: ValidRoles[],
  permissions: P[],
): JwtAccessPayload => ({
  sub,
  email: `${sub}@alternaqj.com`,
  type: 'access',
  entityType: 'user',
  tokenVersion: 1,
  sessionId: 's',
  roles,
  permissions,
});
const VIEW = [P.VIEW_GROWTH_PROSPECTS, P.VIEW_ALL_GROWTH_PROSPECTS];
const admin = actor(ADMIN, [ValidRoles.SUPER_ADMIN_ROL], []);
const manager = actor(
  MANAGER,
  [ValidRoles.GROWTH_MANAGER_ROL],
  [...VIEW, P.MANAGE_GROWTH_SCORING],
);
const editor = actor(
  EDITOR,
  [ValidRoles.GROWTH_MANAGER_ROL],
  [...VIEW, P.MANAGE_GROWTH_SCORING],
);
const approver = actor(
  APPROVER,
  [ValidRoles.GROWTH_MANAGER_ROL],
  [...VIEW, P.APPROVE_GROWTH_SCORING],
);
/** Configura y aprueba: no puede aprobar lo que editó. */
const dual = actor(
  DUAL,
  [ValidRoles.GROWTH_MANAGER_ROL],
  [...VIEW, P.MANAGE_GROWTH_SCORING, P.APPROVE_GROWTH_SCORING],
);

async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  await expect(promise).rejects.toBeInstanceOf(QueryFailedError);
  await expect(promise).rejects.toThrow(pattern);
}

describeDb('Prospect 1E-C-0 — versiones de scoring (base real)', () => {
  let ds: DataSource;
  let sourceId: string;
  let scoring: ScoringService;
  let versions: ScoringVersionsService;
  let catchup: ScoringCatchupService;
  let orgs: OrganizationsService;
  let people: PeopleService;
  let channels: ChannelsService;
  const src = () => ({
    sourceId,
    consultedAt: new Date(),
    reliability: GrowthEvidenceReliability.HIGH,
  });
  const recomputeAll = async () => {
    for (const t of await scoring.scorableIds())
      await scoring.recompute(t.kind, t.id);
  };
  type StoredScore = {
    id: string;
    score: number;
    priority: GrowthPriority;
    version_id: string;
  };
  const stored = async (): Promise<Map<string, StoredScore>> => {
    const rows: StoredScore[] = await ds.query(
      `SELECT coalesce(organization_id, person_id)::text AS id, score, priority, version_id
         FROM growth.prospect_scores`,
    );
    return new Map(rows.map((r) => [r.id, r]));
  };
  /** Todo lo que decide si se puede contactar a alguien. */
  const contactSnapshot = async () =>
    JSON.stringify({
      people: await ds.query(`SELECT * FROM growth.people ORDER BY id`),
      personChannels: await ds.query(
        `SELECT * FROM growth.person_channels ORDER BY id`,
      ),
      orgChannels: await ds.query(
        `SELECT * FROM growth.organization_channels ORDER BY id`,
      ),
      contactable: await ds.query(
        `SELECT * FROM growth.v_contactable_person_channels ORDER BY 1`,
      ),
      suppressions: await ds.query(
        `SELECT count(*)::int AS n FROM growth.suppressions`,
      ),
    });

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      url: URL,
      entities: [
        ActivityEvent,
        GrowthDataSource,
        TeamMember,
        Suppression,
        SuppressionHash,
        Organization,
        Person,
        Property,
        OrganizationChannel,
        PersonChannel,
        Employment,
        PropertyManagement,
        Evidence,
        ProspectAssignment,
        GrowthSettings,
        DuplicateCandidate,
        MergeLog,
        ScoringRule,
        ProspectScore,
        ScoringVersion,
        ProspectScoreHistory,
      ],
      synchronize: false,
    });
    await ds.initialize();
    await resetGrowthTestData(ds, ['eeeeeeee-']);
    for (const [i, id] of [ADMIN, MANAGER, EDITOR, APPROVER, DUAL].entries()) {
      await ds.query(
        `INSERT INTO public.users (id, name, last_name, number_phone, email, password)
         VALUES ($1, 'Scoring', 'IT', $2, $3, 'x')`,
        [id, `300888000${i}`, `scoring-it-${i}@alternaqj.com`],
      );
    }
    await ds.query(
      `UPDATE growth.data_sources SET legal_review_status = 'APPROVED', legal_review_reference = 'Concepto IT',
              legal_reviewed_by_user_id = $1, legal_reviewed_at = now(), status = 'ACTIVE'
        WHERE code = 'MANUAL_RESEARCH'`,
      [ADMIN],
    );
    [{ id: sourceId }] = await ds.query(
      `SELECT id FROM growth.data_sources WHERE code = 'MANUAL_RESEARCH'`,
    );

    const activity = new ActivityLogService(ds.getRepository(ActivityEvent));
    const hashes = new GrowthHashService({
      get: (k: string) =>
        k === 'GROWTH_SUPPRESSION_HMAC_KEYS'
          ? `1:${Buffer.alloc(32, 6).toString('base64')}`
          : '1',
    } as unknown as ConfigService);
    const guards = new ProspectGuardsService(ds, activity);
    const evidences = new EvidencesService(ds, guards, activity);
    const suppressions = new SuppressionsService(ds, hashes, activity);
    scoring = new ScoringService(ds, activity);
    const simulation = new ScoringSimulationService(ds, scoring);
    // Sin cola: el recálculo lo hacen las pruebas, como el cron de puesta al día.
    versions = new ScoringVersionsService(
      ds,
      activity,
      guards,
      scoring,
      simulation,
    );
    catchup = new ScoringCatchupService(ds, versions);
    orgs = new OrganizationsService(ds, guards, evidences, activity);
    people = new PeopleService(ds, guards, evidences, activity);
    channels = new ChannelsService(
      ds,
      guards,
      evidences,
      suppressions,
      activity,
    );

    // Prospectos con hechos distintos para que los cambios muevan prioridades.
    for (const [i, est] of [0, 1, 3, 5, 12, 25].entries()) {
      await orgs.create(
        {
          legalName: `Versiones ${i} SAS`,
          estimatedProperties: est,
          estimatedUnits: est * 60,
          interestSignal:
            i % 2 ? GrowthInterestSignal.DEMO_REQUESTED : undefined,
          source: src(),
        },
        admin,
      );
    }
    const ana = await people.create(
      {
        fullName: 'Ana Independiente',
        isIndependentAdmin: true,
        source: src(),
      },
      admin,
    );
    await channels.addToPerson(
      ana.id,
      {
        kind: GrowthChannelKind.EMAIL,
        value: 'ana@independiente.co',
        channelClass: 'PROFESSIONAL' as never,
        source: src(),
      },
      admin,
    );
    await recomputeAll();
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('estado inicial: la versión 1 es la vigente, con las reglas y umbrales de antes, sin aprobador; el permiso de aprobar nace inactivo y sin rol', async () => {
    const [v1] = await versions.list([Status.ACTIVE]);
    expect(v1.number).toBe(1);
    expect(v1.origin).toBe(GrowthScoringVersionOrigin.MIGRATION);
    expect(v1.approvedByUserId).toBeNull();
    expect(v1.thresholds).toEqual({ high: 50, medium: 25 });
    expect(v1.rules.map((r) => [r.key, r.points]).sort()).toEqual(
      SEED_SCORING_RULES.map((r) => [r.key, r.points]).sort(),
    );
    const status = await versions.status();
    expect(status.activeVersion.id).toBe(v1.id);
    expect(status.staleScores).toBe(0);
    expect(status.missingScores).toBe(0);
    const [perm] = await ds.query(
      `SELECT status FROM public.permissions WHERE name::text = 'APPROVE_GROWTH_SCORING'`,
    );
    expect(perm.status).toBe(false);
    const [{ n }] = await ds.query(
      `SELECT count(*)::int AS n FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id
        WHERE p.name::text = 'APPROVE_GROWTH_SCORING'`,
    );
    expect(n).toBe(0);
  });

  let draftId: string;

  it('un borrador copia la versión activa y se edita; solo el borrador cambia', async () => {
    const draft = await versions.createDraft({ notes: 'Prueba IT' }, manager);
    draftId = draft.id;
    expect(draft.status).toBe(Status.DRAFT);
    expect(draft.number).toBe(2);
    expect(draft.contributorUserIds).toEqual([MANAGER]);
    const edited = await versions.updateDraft(
      {
        id: draft.id,
        thresholds: { high: 30, medium: 10 },
        rules: draft.rules.map((r, i) =>
          i === 0 ? { ...r, points: r.points + 5 } : r,
        ),
      },
      editor,
    );
    expect(edited.contributorUserIds.sort()).toEqual([EDITOR, MANAGER].sort());
    // La activa no cambió.
    const [active] = await versions.list([Status.ACTIVE]);
    expect(active.number).toBe(1);
    expect(active.thresholds).toEqual({ high: 50, medium: 25 });
  });

  it('la comparación no guarda nada y la simulación de 1E-0 sin cambios coincide con lo guardado', async () => {
    const before = await ds.query(
      `SELECT (SELECT count(*) FROM growth.activity_events)::int AS events,
              (SELECT count(*) FROM growth.prospect_score_history)::int AS history,
              (SELECT max(computed_at) FROM growth.prospect_scores) AS last`,
    );
    const cmp = await versions.compare(draftId, approver, 100);
    expect(cmp.evaluated).toBe(7);
    expect(cmp.changedPriority).toBeGreaterThan(0);
    const after = await ds.query(
      `SELECT (SELECT count(*) FROM growth.activity_events)::int AS events,
              (SELECT count(*) FROM growth.prospect_score_history)::int AS history,
              (SELECT max(computed_at) FROM growth.prospect_scores) AS last`,
    );
    expect(after).toEqual(before);
    // Sin permiso de configurar ni aprobar, no se compara.
    await expect(
      versions.compare(draftId, actor(ADMIN, [], VIEW), 10),
    ).rejects.toThrow(/configurar o aprobar/);
  });

  it('separación de funciones: no activa quien no aprueba, ni quien propuso o editó; sí un tercero con APPROVE', async () => {
    await expect(versions.activate(draftId, manager)).rejects.toThrow(
      /APPROVE_GROWTH_SCORING/,
    );
    // `dual` puede aprobar, pero si edita el borrador ya no puede aprobarlo.
    const d2 = await versions.createDraft({}, dual);
    await expect(versions.activate(d2.id, dual)).rejects.toThrow(
      /no puede aprobarlo/,
    );
    await versions.discardDraft(d2.id, 'Prueba de separación', dual);
    // Uno descartado ya no se activa.
    await expect(versions.activate(d2.id, approver)).rejects.toThrow(
      /Solo un borrador/,
    );
  });

  it('simulación idéntica al cálculo definitivo: lo que predijo la comparación es lo que queda guardado', async () => {
    const cmp = await versions.compare(draftId, approver, 100);
    const contactBefore = await contactSnapshot();
    const activated = await versions.activate(draftId, approver);
    expect(activated.status).toBe(Status.ACTIVE);
    expect(activated.approvedByUserId).toBe(APPROVER);
    expect(activated.selfApprovalException).toBe(false);

    // Antes de recalcular, cada puntaje dice que es de otra versión.
    const pending = await versions.status();
    expect(pending.activeVersion.id).toBe(draftId);
    expect(pending.staleScores).toBe(7);

    expect(await versions.rescorePending()).toBe(7);
    const now = await stored();
    for (const item of cmp.items) {
      expect(now.get(item.id)).toMatchObject({
        score: item.proposedScore,
        priority: item.proposedPriority,
        version_id: draftId,
      });
    }
    // Y la distribución completa coincide (también la de los que no cambiaron).
    const byPriority = (p: GrowthPriority) =>
      [...now.values()].filter((r) => r.priority === p).length;
    expect(byPriority(GrowthPriority.HIGH)).toBe(cmp.proposed.high);
    expect(byPriority(GrowthPriority.MEDIUM)).toBe(cmp.proposed.medium);
    expect(byPriority(GrowthPriority.LOW)).toBe(cmp.proposed.low);
    expect((await versions.status()).staleScores).toBe(0);

    // El scoring nunca toca lo que decide el contacto.
    expect(await contactSnapshot()).toBe(contactBefore);
  });

  it('activar retira la anterior, refleja reglas y umbrales en las tablas de 1B y deja la actividad', async () => {
    const v1 = (await versions.list([Status.RETIRED])).find(
      (v) => v.number === 1,
    )!;
    expect(v1.number).toBe(1);
    expect(v1.retiredReason).toMatch(/versión 2/);
    const settings = await ds
      .getRepository(GrowthSettings)
      .findOneByOrFail({ id: 1 });
    expect([
      settings.scoringHighThreshold,
      settings.scoringMediumThreshold,
    ]).toEqual([30, 10]);
    const active = await versions.get(draftId);
    const mirrored = await ds.getRepository(ScoringRule).find();
    for (const r of active.rules) {
      expect(mirrored.find((m) => m.key === r.key)).toMatchObject({
        points: r.points,
        active: r.active,
      });
    }
    const actions = (
      await ds.getRepository(ActivityEvent).find({
        where: { entityType: 'SCORING_VERSION' as never },
        order: { createdAt: 'ASC' },
      })
    ).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'SCORING_DRAFT_CREATED',
        'SCORING_DRAFT_UPDATED',
        'SCORING_DRAFT_DISCARDED',
        'SCORING_VERSION_RETIRED',
        'SCORING_VERSION_ACTIVATED',
      ]),
    );
  });

  it('historial: un puntaje nuevo por versión, sin duplicados al recalcular de nuevo; la base no lo deja cambiar', async () => {
    const before = (
      await ds.query(
        `SELECT count(*)::int AS n FROM growth.prospect_score_history`,
      )
    )[0].n;
    await recomputeAll();
    expect((await versions.rescorePending()) + 0).toBe(0);
    const after = (
      await ds.query(
        `SELECT count(*)::int AS n FROM growth.prospect_score_history`,
      )
    )[0].n;
    expect(after).toBe(before);
    const [org] = await ds.query(
      `SELECT id FROM growth.organizations WHERE legal_name = 'Versiones 3 SAS'`,
    );
    const page = await versions.history(K.ORGANIZATION, org.id, approver, {
      page: 1,
      limit: 10,
    });
    expect(page.items.map((h) => h.versionId)).toContain(draftId);
    const v1 = (await versions.list([Status.RETIRED])).find(
      (v) => v.number === 1,
    )!;
    expect(page.items.map((h) => h.versionId)).toContain(v1.id);
    await expectDbError(
      ds.query(`UPDATE growth.prospect_score_history SET score = 0`),
      /append-only/,
    );
    await expectDbError(
      ds.query(`DELETE FROM growth.prospect_score_history`),
      /append-only/,
    );
  });

  it('la base protege las versiones: fuera del borrador no cambian, no se borran, solo una activa y nunca activa sin aprobador', async () => {
    await expectDbError(
      ds.query(
        `UPDATE growth.scoring_versions SET thresholds = '{"high": 90, "medium": 10}' WHERE status = 'ACTIVE'`,
      ),
      /no cambian fuera del borrador/,
    );
    await expectDbError(
      ds.query(
        `UPDATE growth.scoring_versions SET status = 'DRAFT' WHERE status = 'ACTIVE'`,
      ),
      /transición ACTIVE -> DRAFT/,
    );
    await expectDbError(
      ds.query(
        `UPDATE growth.scoring_versions SET notes = 'x' WHERE status = 'RETIRED'`,
      ),
      /retirada no se modifica/,
    );
    await expectDbError(
      ds.query(`DELETE FROM growth.scoring_versions`),
      /append-only/,
    );
    await expectDbError(
      ds.query(
        `INSERT INTO growth.scoring_versions (number, status, origin, rules, thresholds, approved_at, activated_at)
         VALUES (99, 'DRAFT', 'MIGRATION', '[]', '{"high": 50, "medium": 25}', NULL, NULL)`,
      ),
      /ck_growth_scoring_version_migration/,
    );
    // Activar un borrador por SQL, sin aprobador: la base lo rechaza.
    const draft = await versions.createDraft({}, manager);
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query(
        `UPDATE growth.scoring_versions SET status = 'RETIRED', retired_at = now() WHERE status = 'ACTIVE'`,
      );
      await expect(
        runner.query(
          `UPDATE growth.scoring_versions SET status = 'ACTIVE', approved_at = now(), activated_at = now() WHERE id = $1`,
          [draft.id],
        ),
      ).rejects.toThrow(/ck_growth_scoring_version_active/);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
    await versions.discardDraft(draft.id, 'Prueba de la base', manager);
    expect((await versions.list([Status.ACTIVE])).map((v) => v.id)).toEqual([
      draftId,
    ]);
  });

  it('recuperación: si el recálculo se cae a mitad, al retomarlo termina sin duplicar historial; el cron no corre dos veces', async () => {
    const d3 = await versions.createDraft({}, manager);
    await versions.updateDraft(
      { id: d3.id, thresholds: { high: 60, medium: 20 } },
      manager,
    );
    await versions.activate(d3.id, approver);
    expect((await versions.status()).staleScores).toBe(7);

    const original = scoring.recompute.bind(scoring);
    let calls = 0;
    scoring.recompute = async (
      ...args: Parameters<ScoringService['recompute']>
    ) => {
      calls++;
      if (calls === 3) throw new Error('caída simulada');
      return original(...args);
    };
    try {
      await expect(versions.rescorePending()).rejects.toThrow('caída simulada');
    } finally {
      scoring.recompute = original;
    }
    const half = await versions.status();
    expect(half.currentScores).toBe(2);
    expect(half.staleScores).toBe(5);

    // Con otra réplica trabajando (lock tomado), el cron no hace nada.
    const other = ds.createQueryRunner();
    await other.connect();
    await other.query(
      `SELECT pg_advisory_lock(hashtextextended('growth-scoring-catchup', 0))`,
    );
    try {
      expect(await catchup.catchUp()).toBe(0);
    } finally {
      await other.query(
        `SELECT pg_advisory_unlock(hashtextextended('growth-scoring-catchup', 0))`,
      );
      await other.release();
    }
    expect(await catchup.catchUp()).toBe(5);
    expect((await versions.status()).staleScores).toBe(0);

    const [{ dup }] = await ds.query(
      `SELECT count(*)::int AS dup FROM (
         SELECT coalesce(organization_id, person_id), version_id, count(*)
           FROM growth.prospect_score_history WHERE version_id = $1
          GROUP BY 1, 2 HAVING count(*) > 1) x`,
      [d3.id],
    );
    expect(dup).toBe(0);
  });

  it('excepción de SUPER_ADMIN: con ella aprueba su propio borrador y queda auditado; sin ella, no', async () => {
    await ds.query(
      `UPDATE growth.settings SET allow_super_admin_self_validation = false`,
    );
    const own = await versions.createDraft({}, admin);
    await expect(versions.activate(own.id, admin)).rejects.toThrow(
      /no puede aprobarlo/,
    );
    await ds.query(
      `UPDATE growth.settings SET allow_super_admin_self_validation = true`,
    );
    const activated = await versions.activate(own.id, admin);
    expect(activated.selfApprovalException).toBe(true);
    const events = await ds
      .getRepository(ActivityEvent)
      .findBy({ entityId: own.id, action: 'SCORING_SELF_APPROVAL_EXCEPTION' });
    expect(events).toHaveLength(1);
  });

  it('las mutaciones de 1B ya no cambian reglas ni umbrales al instante', async () => {
    const [rule] = await ds.getRepository(ScoringRule).find({ take: 1 });
    await expect(
      scoring.updateRule(rule.id, { points: 1 }, manager),
    ).rejects.toThrow(/borrador/);
    await expect(
      scoring.updateThresholds({ high: 70, medium: 20 }, manager),
    ).rejects.toThrow(/borrador/);
  });
});

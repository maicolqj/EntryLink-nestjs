/**
 * Integración de la entrega 1B (deduplicación, fusión manual y scoring)
 * contra Postgres REAL. Solo base desechable (ver docs/growth/TESTING.md).
 */
import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { DataSource, QueryFailedError } from 'typeorm';
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
  DuplicateCandidate,
  MergeLog,
  ProspectScore,
  ScoringRule,
} from '../../src/modules/growth/prospects/entities/dedupe-scoring.entity';
import { Evidence } from '../../src/modules/growth/prospects/entities/evidence.entity';
import { GrowthSettings } from '../../src/modules/growth/prospects/entities/growth-settings.entity';
import { Organization } from '../../src/modules/growth/prospects/entities/organization.entity';
import { Person } from '../../src/modules/growth/prospects/entities/person.entity';
import { Property } from '../../src/modules/growth/prospects/entities/property.entity';
import { ProspectAssignment } from '../../src/modules/growth/prospects/entities/prospect-assignment.entity';
import {
  Employment,
  PropertyManagement,
} from '../../src/modules/growth/prospects/entities/relations.entity';
import {
  GrowthChannelClass,
  GrowthChannelKind,
  GrowthContactStatus,
  GrowthDuplicateStatus,
  GrowthEvidenceReliability,
  GrowthInterestSignal,
  GrowthManagerType,
  GrowthMergeSide,
  GrowthPriority,
  GrowthProspectKind as K,
  GrowthRelationStatus,
  GrowthScoreBasis,
  GrowthScoringPredicate,
} from '../../src/modules/growth/prospects/prospects.enums';
import { AssignmentsService } from '../../src/modules/growth/prospects/services/assignments.service';
import { ChannelsService } from '../../src/modules/growth/prospects/services/channels.service';
import { DedupeService } from '../../src/modules/growth/prospects/services/dedupe.service';
import { EvidencesService } from '../../src/modules/growth/prospects/services/evidences.service';
import { MergeService } from '../../src/modules/growth/prospects/services/merge.service';
import { OrganizationsService } from '../../src/modules/growth/prospects/services/organizations.service';
import { PeopleService } from '../../src/modules/growth/prospects/services/people.service';
import { PropertiesService } from '../../src/modules/growth/prospects/services/properties.service';
import { ProspectDashboardService } from '../../src/modules/growth/prospects/services/prospect-dashboard.service';
import { ProspectGuardsService } from '../../src/modules/growth/prospects/services/prospect-guards.service';
import { ProspectJobsProcessor } from '../../src/modules/growth/prospects/services/prospect-jobs.processor';
import { RelationshipsService } from '../../src/modules/growth/prospects/services/relationships.service';
import { ScoringService } from '../../src/modules/growth/prospects/services/scoring.service';
import { resetGrowthTestData } from './db-cleanup';

const URL = process.env.GROWTH_IT_DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

const ADMIN = 'cccccccc-0000-4000-8000-000000000001';
const admin: JwtAccessPayload = {
  sub: ADMIN,
  email: 'admin@alternaqj.com',
  type: 'access',
  entityType: 'user',
  tokenVersion: 1,
  sessionId: 's',
  roles: [ValidRoles.SUPER_ADMIN_ROL],
  permissions: [],
};

async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  await expect(promise).rejects.toBeInstanceOf(QueryFailedError);
  await expect(promise).rejects.toThrow(pattern);
}

describeDb('Prospect 1B — duplicados, fusión y scoring (base real)', () => {
  let ds: DataSource;
  let sourceId: string;
  let s: {
    orgs: OrganizationsService;
    people: PeopleService;
    props: PropertiesService;
    channels: ChannelsService;
    rel: RelationshipsService;
    assignments: AssignmentsService;
    dedupe: DedupeService;
    merge: MergeService;
    scoring: ScoringService;
    processor: ProspectJobsProcessor;
    dashboard: ProspectDashboardService;
  };
  const src = () => ({
    sourceId,
    consultedAt: new Date(),
    reliability: GrowthEvidenceReliability.HIGH,
  });
  const candidateFor = (a: string, b: string) => {
    const [left, right] = [a, b].sort();
    return ds
      .getRepository(DuplicateCandidate)
      .findOneBy({ leftId: left, rightId: right });
  };

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
      ],
      synchronize: false,
    });
    await ds.initialize();
    await resetGrowthTestData(ds, ['aaaaaaaa-', 'bbbbbbbb-', 'cccccccc-']);
    await ds.query(
      `INSERT INTO public.users (id, name, last_name, number_phone, email, password)
       VALUES ($1, 'Admin', 'Dedupe', '3007770001', 'admin-dedupe@alternaqj.com', 'x')`,
      [ADMIN],
    );
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
          ? `1:${Buffer.alloc(32, 5).toString('base64')}`
          : '1',
    } as unknown as ConfigService);
    const guards = new ProspectGuardsService(ds, activity);
    const evidences = new EvidencesService(ds, guards, activity);
    const suppressions = new SuppressionsService(ds, hashes, activity);
    const dedupe = new DedupeService(ds, activity);
    const scoring = new ScoringService(ds, activity);
    s = {
      orgs: new OrganizationsService(ds, guards, evidences, activity),
      people: new PeopleService(ds, guards, evidences, activity),
      props: new PropertiesService(ds, guards, evidences, activity),
      channels: new ChannelsService(
        ds,
        guards,
        evidences,
        suppressions,
        activity,
      ),
      rel: new RelationshipsService(ds, guards, evidences, activity),
      assignments: new AssignmentsService(ds, guards, activity),
      dedupe,
      merge: new MergeService(ds, guards, activity),
      scoring,
      processor: new ProspectJobsProcessor(ds, dedupe, scoring),
      dashboard: new ProspectDashboardService(ds, activity),
    };
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  describe('detección de posibles duplicados', () => {
    it('empresas con el mismo correo y nombre parecido: candidato con ambas señales; nada se fusiona solo', async () => {
      const a = await s.orgs.create(
        { legalName: 'Administraciones Andes SAS', source: src() },
        admin,
      );
      const b = await s.orgs.create(
        { legalName: 'Administracion Andes S.A.S.', source: src() },
        admin,
      );
      await s.channels.addToOrganization(
        a.id,
        {
          kind: GrowthChannelKind.EMAIL,
          value: 'info@andesph.co',
          source: src(),
        },
        admin,
      );
      await s.channels.addToOrganization(
        b.id,
        {
          kind: GrowthChannelKind.EMAIL,
          value: 'INFO@andesph.co',
          source: src(),
        },
        admin,
      );

      expect(await s.dedupe.scan(K.ORGANIZATION, a.id)).toBe(1);
      const c = await candidateFor(a.id, b.id);
      expect(c!.status).toBe(GrowthDuplicateStatus.PENDING);
      expect(c!.matchedOn.sort()).toEqual(['EMAIL', 'NAME']);
      expect(c!.score).toBe(100);
      const both = await ds
        .getRepository(Organization)
        .findBy([{ id: a.id }, { id: b.id }]);
      expect(
        both.every((o) => !o.mergedIntoId && o.validationStatus === 'NEW'),
      ).toBe(true);
    });

    it('copropiedades con la misma matrícula inmobiliaria', async () => {
      const p1 = await s.props.create(
        {
          name: 'Conjunto Mirador',
          realEstateRegistration: '50C-123',
          source: src(),
        },
        admin,
      );
      const p2 = await s.props.create(
        {
          name: 'Edificio Otro Nombre',
          realEstateRegistration: '50c 123',
          source: src(),
        },
        admin,
      );
      await s.dedupe.scan(K.PROPERTY, p2.id);
      expect((await candidateFor(p1.id, p2.id))!.matchedOn).toContain(
        'REGISTRATION',
      );
    });

    it('personas homónimas sin empresa ni copropiedad en común no se proponen', async () => {
      const x = await s.people.create(
        { fullName: 'Juan Pérez', isIndependentAdmin: false, source: src() },
        admin,
      );
      const y = await s.people.create(
        { fullName: 'Juan Perez', isIndependentAdmin: false, source: src() },
        admin,
      );
      expect(await s.dedupe.scan(K.PERSON, x.id)).toBe(0);
      const org = await s.orgs.create(
        { legalName: 'Empresa Común SAS', source: src() },
        admin,
      );
      for (const p of [x, y]) {
        await s.rel.linkEmployment(
          {
            personId: p.id,
            organizationId: org.id,
            status: GrowthRelationStatus.CURRENT,
            source: src(),
          },
          admin,
        );
      }
      expect(await s.dedupe.scan(K.PERSON, x.id)).toBe(1);
    });

    it('un par descartado no se reabre al volver a escanear', async () => {
      const a = await s.orgs.create(
        {
          legalName: 'Gestión Integral Uno SAS',
          website: 'https://www.gestionuno.co',
          source: src(),
        },
        admin,
      );
      const b = await s.orgs.create(
        {
          legalName: 'Otra Razón Social SAS',
          website: 'gestionuno.co/contacto',
          source: src(),
        },
        admin,
      );
      await s.dedupe.scan(K.ORGANIZATION, b.id);
      const c = await candidateFor(a.id, b.id);
      expect(c!.matchedOn).toContain('DOMAIN');
      await s.dedupe.dismiss(
        c!.id,
        'Son empresas distintas del mismo grupo',
        admin,
      );
      await s.dedupe.scan(K.ORGANIZATION, b.id);
      expect((await candidateFor(a.id, b.id))!.status).toBe(
        GrowthDuplicateStatus.DISMISSED,
      );
    });
  });

  describe('fusión manual', () => {
    it('exige elegir valor en cada conflicto; traslada todo; el absorbido no se borra; queda merge_log', async () => {
      const a = await s.orgs.create(
        {
          legalName: 'Andes Propiedad Horizontal SAS',
          address: 'Calle 100 # 15-20',
          source: src(),
        },
        admin,
      );
      const b = await s.orgs.create(
        {
          legalName: 'Andes PH SAS',
          nit: '901222333',
          address: 'Cra 7 # 72-10',
          source: src(),
        },
        admin,
      );
      await s.channels.addToOrganization(
        b.id,
        { kind: GrowthChannelKind.PHONE, value: '601 555 1234', source: src() },
        admin,
      );
      await s.channels.addToOrganization(
        a.id,
        { kind: GrowthChannelKind.PHONE, value: '6015551234', source: src() },
        admin,
      );
      const prop = await s.props.create(
        { name: 'Torres del Parque', source: src() },
        admin,
      );
      await s.rel.setPropertyManager(
        {
          propertyId: prop.id,
          managerType: GrowthManagerType.ORGANIZATION,
          organizationId: b.id,
          status: GrowthRelationStatus.CURRENT,
          source: src(),
        },
        admin,
      );
      await s.dedupe.scan(K.ORGANIZATION, b.id);
      const c = (await candidateFor(a.id, b.id))!;

      await expect(
        s.merge.merge(
          {
            candidateId: c.id,
            survivorId: a.id,
            fieldChoices: [],
            note: 'Misma empresa',
          },
          admin,
        ),
      ).rejects.toThrow(/legalName.*address|address.*legalName/);

      const log = await s.merge.merge(
        {
          candidateId: c.id,
          survivorId: a.id,
          fieldChoices: [
            { field: 'legalName', side: GrowthMergeSide.SURVIVOR },
            { field: 'address', side: GrowthMergeSide.MERGED },
          ],
          note: 'Misma empresa: confirmado por RUES',
        },
        admin,
      );
      expect(log.fieldChoices).toEqual({
        legalName: 'SURVIVOR',
        address: 'MERGED',
        nit: 'MERGED_AUTO',
      });
      expect(log.moved.channels).toBe(1);
      expect(log.moved.managements).toBe(1);

      const survivor = await ds
        .getRepository(Organization)
        .findOneByOrFail({ id: a.id });
      expect(survivor.nit).toBe('901222333');
      expect(survivor.addressNormalized).toBe('KR 7 72 10');
      const merged = await ds
        .getRepository(Organization)
        .findOneByOrFail({ id: b.id });
      expect(merged.mergedIntoId).toBe(a.id);
      expect(merged.validationStatus).toBe('DUPLICATE');
      expect(merged.nit).toBeNull();

      const evidenceOnSurvivor = await ds
        .getRepository(Evidence)
        .countBy({ entityType: 'ORGANIZATION' as never, entityId: a.id });
      expect(evidenceOnSurvivor).toBeGreaterThan(3);
      expect((await candidateFor(a.id, b.id))!.status).toBe(
        GrowthDuplicateStatus.MERGED,
      );

      const list = await s.orgs.list(
        admin,
        { search: 'andes' },
        { page: 1, limit: 100 },
      );
      expect(list.items.map((o) => o.id)).not.toContain(b.id);

      await expectDbError(
        ds.query(`DELETE FROM growth.merge_log WHERE id = $1`, [log.id]),
        /append-only/,
      );
      await expectDbError(
        ds.query(
          `UPDATE growth.organizations SET merged_into_id = NULL WHERE id = $1`,
          [b.id],
        ),
        /fusionado no se modifica/,
      );
    });

    it('la base no deja marcar DUPLICATE desde VALIDATED sin fusión', async () => {
      const o = await s.orgs.create(
        { legalName: 'Validada Sin Fusión SAS', source: src() },
        admin,
      );
      await ds.query(
        `UPDATE growth.organizations SET validation_status = 'PENDING_REVIEW' WHERE id = $1`,
        [o.id],
      );
      await ds.query(
        `UPDATE growth.organizations SET validation_status = 'IN_VALIDATION', validation_taken_by_user_id = $2 WHERE id = $1`,
        [o.id, ADMIN],
      );
      await ds.query(
        `UPDATE growth.organizations SET validation_status = 'VALIDATED', validated_by_user_id = $2, validated_at = now() WHERE id = $1`,
        [o.id, ADMIN],
      );
      await expectDbError(
        ds.query(
          `UPDATE growth.organizations SET validation_status = 'DUPLICATE' WHERE id = $1`,
          [o.id],
        ),
        /VALIDATED -> DUPLICATE no permitida/,
      );
    });

    it('copropiedades con administración vigente en ambas: la del absorbido pasa a historial', async () => {
      const org1 = await s.orgs.create(
        { legalName: 'Admin Vigente Uno SAS', source: src() },
        admin,
      );
      const org2 = await s.orgs.create(
        { legalName: 'Admin Vigente Dos SAS', source: src() },
        admin,
      );
      const p1 = await s.props.create(
        {
          name: 'Conjunto Las Acacias',
          address: 'Calle 145 # 9-20',
          source: src(),
        },
        admin,
      );
      const p2 = await s.props.create(
        {
          name: 'Conjunto Residencial Las Acacias',
          address: 'Calle 145 # 9-20',
          source: src(),
        },
        admin,
      );
      for (const [p, o] of [
        [p1, org1],
        [p2, org2],
      ] as const) {
        await s.rel.setPropertyManager(
          {
            propertyId: p.id,
            managerType: GrowthManagerType.ORGANIZATION,
            organizationId: o.id,
            status: GrowthRelationStatus.CURRENT,
            source: src(),
          },
          admin,
        );
      }
      await s.dedupe.scan(K.PROPERTY, p2.id);
      const c = (await candidateFor(p1.id, p2.id))!;
      await s.merge.merge(
        {
          candidateId: c.id,
          survivorId: p1.id,
          fieldChoices: [{ field: 'name', side: GrowthMergeSide.SURVIVOR }],
          note: 'Misma copropiedad',
        },
        admin,
      );
      const history = await s.rel.managementsOfProperty(p1.id);
      expect(history.map((h) => h.status).sort()).toEqual(['CURRENT', 'PAST']);
    });

    it('personas: el contacto autorizado del sobreviviente se revoca tras la fusión', async () => {
      const p1 = await s.people.create(
        { fullName: 'Laura Martínez', isIndependentAdmin: true, source: src() },
        admin,
      );
      const p2 = await s.people.create(
        { fullName: 'Laura Martinez', isIndependentAdmin: true, source: src() },
        admin,
      );
      await s.channels.addToPerson(
        p1.id,
        {
          kind: GrowthChannelKind.EMAIL,
          value: 'laura@adminph.co',
          channelClass: GrowthChannelClass.PROFESSIONAL,
          source: src(),
        },
        admin,
      );
      await s.channels.addToPerson(
        p2.id,
        {
          kind: GrowthChannelKind.EMAIL,
          value: 'laura@adminph.co',
          channelClass: GrowthChannelClass.PROFESSIONAL,
          source: src(),
        },
        admin,
      );
      // Contacto autorizado directo en base (camino completo probado en 1A).
      await ds.query(
        `UPDATE growth.people SET legal_basis = 'PRIOR_AUTHORIZATION', legal_basis_reference = 'RAD-1',
                legal_basis_reviewed_by_user_id = $2, legal_basis_reviewed_at = now(),
                contact_status = 'AUTHORIZED', contact_authorized_by_user_id = $2, contact_authorized_at = now()
          WHERE id = $1`,
        [p1.id, ADMIN],
      );
      await s.dedupe.scan(K.PERSON, p2.id);
      const c = (await candidateFor(p1.id, p2.id))!;
      await s.merge.merge(
        {
          candidateId: c.id,
          survivorId: p1.id,
          fieldChoices: [{ field: 'fullName', side: GrowthMergeSide.SURVIVOR }],
          note: 'Misma persona',
        },
        admin,
      );
      const survivor = await ds
        .getRepository(Person)
        .findOneByOrFail({ id: p1.id });
      expect(survivor.contactStatus).toBe(GrowthContactStatus.REVOKED);
      const contactable = await ds.query(
        `SELECT 1 FROM growth.v_contactable_person_channels WHERE person_id = $1`,
        [p1.id],
      );
      expect(contactable).toEqual([]);
    });
  });

  describe('scoring', () => {
    let orgId: string;

    beforeAll(async () => {
      const org = await s.orgs.create(
        {
          legalName: 'Scoring Prueba SAS',
          interestSignal: GrowthInterestSignal.DEMO_REQUESTED,
          source: src(),
        },
        admin,
      );
      orgId = org.id;
      const ch = await s.channels.addToOrganization(
        orgId,
        {
          kind: GrowthChannelKind.EMAIL,
          value: 'hola@scoringprueba.co',
          source: src(),
        },
        admin,
      );
      await ds.query(
        `UPDATE growth.organization_channels SET verified_at = now(), verified_by_user_id = $2 WHERE id = $1`,
        [ch.id, ADMIN],
      );
      for (const n of [1, 2, 3]) {
        const p = await s.props.create(
          {
            name: `Copropiedad Scoring ${n}`,
            estimatedUnits: 200,
            source: src(),
          },
          admin,
        );
        await s.rel.setPropertyManager(
          {
            propertyId: p.id,
            managerType: GrowthManagerType.ORGANIZATION,
            organizationId: orgId,
            status: GrowthRelationStatus.CURRENT,
            source: src(),
          },
          admin,
        );
      }
    });

    it('3 copropiedades (+20), 600 unidades (+20), canal verificado (+10), interés (+20) = 70, alta, con estimados', async () => {
      const score = (await s.scoring.recompute(K.ORGANIZATION, orgId))!;
      expect(score.score).toBe(70);
      expect(score.priority).toBe(GrowthPriority.HIGH);
      expect(score.hasEstimates).toBe(true);
      const byKey = Object.fromEntries(
        score.breakdown.map((b) => [b.ruleKey, b]),
      );
      expect(byKey.PROPERTIES_2_TO_4.basis).toBe(GrowthScoreBasis.ESTIMATED); // copropiedades sin validar
      expect(byKey.VERIFIED_CHANNEL.basis).toBe(GrowthScoreBasis.VERIFIED);
      expect(byKey.UNITS_500_PLUS.value).toBe('600');
      // El puntaje no toca la validación.
      expect(
        (await ds.getRepository(Organization).findOneByOrFail({ id: orgId }))
          .validationStatus,
      ).toBe('NEW');
    });

    it('cambiar umbrales sube la versión y cambia la prioridad al recalcular', async () => {
      const before = await ds
        .getRepository(GrowthSettings)
        .findOneByOrFail({ id: 1 });
      await s.scoring.updateThresholds({ high: 80, medium: 30 }, admin);
      const after = await ds
        .getRepository(GrowthSettings)
        .findOneByOrFail({ id: 1 });
      expect(after.scoringVersion).toBe(before.scoringVersion + 1);
      const score = (await s.scoring.recompute(K.ORGANIZATION, orgId))!;
      expect(score.priority).toBe(GrowthPriority.MEDIUM);
      expect(score.rulesVersion).toBe(after.scoringVersion);
      await expectDbError(
        ds.query(
          `UPDATE growth.settings SET scoring_high_threshold = 10, scoring_medium_threshold = 20`,
        ),
        /ck_growth_settings_thresholds/,
      );
    });

    it('reglas: parámetros validados por predicado; predicado desconocido rechazado por la base', async () => {
      const [rule] = await ds
        .getRepository(ScoringRule)
        .findBy({ key: 'UNITS_500_PLUS' });
      await expect(
        s.scoring.updateRule(rule.id, { params: { value: -3 } }, admin),
      ).rejects.toThrow('Parámetros inválidos');
      const updated = await s.scoring.updateRule(
        rule.id,
        { points: 25 },
        admin,
      );
      expect(updated.points).toBe(25);
      await expectDbError(
        ds.query(
          `UPDATE growth.scoring_rules SET predicate = 'SQL_LIBRE' WHERE id = $1`,
          [rule.id],
        ),
        /ck_growth_rules_predicate/,
      );
      const created = await s.scoring.createRule(
        {
          key: 'IT_PROPERTIES_20_PLUS',
          label: 'Más de 20 copropiedades',
          predicate: GrowthScoringPredicate.PROPERTIES_GTE,
          params: { min: 20 },
          points: 10,
          appliesTo: [K.ORGANIZATION],
        },
        admin,
      );
      expect(created.active).toBe(true);
    });

    it('un cambio en una copropiedad recalcula a quien la administra (trabajo de cola)', async () => {
      await ds.query(
        `DELETE FROM growth.prospect_scores WHERE organization_id = $1`,
        [orgId],
      );
      const [{ property_id }] = await ds.query(
        `SELECT property_id FROM growth.property_managements WHERE organization_id = $1 LIMIT 1`,
        [orgId],
      );
      await s.processor.score(K.PROPERTY, property_id);
      expect(await s.scoring.getScore(K.ORGANIZATION, orgId)).not.toBeNull();
    });

    it('personas que no son administradores independientes no tienen puntaje', async () => {
      const p = await s.people.create(
        {
          fullName: 'Contacto Sin Puntaje',
          isIndependentAdmin: false,
          source: src(),
        },
        admin,
      );
      expect(await s.scoring.recompute(K.PERSON, p.id)).toBeNull();
    });

    it('el dashboard muestra prioridades, los de mayor puntaje y duplicados pendientes', async () => {
      const d = await s.dashboard.dashboard(admin);
      expect(d.topProspects.length).toBeGreaterThan(0);
      expect(d.topProspects[0].score).toBeGreaterThanOrEqual(
        d.topProspects.at(-1)!.score,
      );
      expect(d.priorityCounts.reduce((a, b) => a + b.count, 0)).toBeGreaterThan(
        0,
      );
      expect(d.pendingDuplicates).toBeGreaterThanOrEqual(1);
    });
  });
});

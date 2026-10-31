/**
 * Integración de EntryLink Prospect (entrega 1A) contra Postgres REAL con
 * todas las migraciones aplicadas. Solo base desechable (ver TESTING.md).
 *
 *   GROWTH_IT_DATABASE_URL=postgres://postgres:***@127.0.0.1:55432/growth_test \
 *     yarn test:growth:int
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
import { GROWTH_ROLES } from '../../src/modules/growth/shared/growth-access.catalog';
import { GrowthHashService } from '../../src/modules/growth/shared/growth-hash.service';
import {
  GrowthEntityType,
  GrowthSuppressionReason,
  GrowthSuppressionScope,
  GrowthIdentifierType,
} from '../../src/modules/growth/shared/growth.enums';
import { GrowthDataSource } from '../../src/modules/growth/sources/entities/growth-data-source.entity';
import { TeamMember } from '../../src/modules/growth/team/entities/team-member.entity';
import {
  OrganizationChannel,
  PersonChannel,
} from '../../src/modules/growth/prospects/entities/channels.entity';
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
  GrowthEvidenceReliability,
  GrowthEvidenceStatus,
  GrowthLegalBasis,
  GrowthManagerType,
  GrowthProspectKind as K,
  GrowthRelationStatus,
  GrowthValidationDecision,
} from '../../src/modules/growth/prospects/prospects.enums';
import { AssignmentsService } from '../../src/modules/growth/prospects/services/assignments.service';
import { ChannelsService } from '../../src/modules/growth/prospects/services/channels.service';
import { EvidencesService } from '../../src/modules/growth/prospects/services/evidences.service';
import { LegalBasisService } from '../../src/modules/growth/prospects/services/legal-basis.service';
import { OrganizationsService } from '../../src/modules/growth/prospects/services/organizations.service';
import { PeopleService } from '../../src/modules/growth/prospects/services/people.service';
import { PropertiesService } from '../../src/modules/growth/prospects/services/properties.service';
import { ProspectDashboardService } from '../../src/modules/growth/prospects/services/prospect-dashboard.service';
import { ProspectGuardsService } from '../../src/modules/growth/prospects/services/prospect-guards.service';
import { RelationshipsService } from '../../src/modules/growth/prospects/services/relationships.service';
import { ValidationService } from '../../src/modules/growth/prospects/services/validation.service';
import { resetGrowthTestData } from './db-cleanup';

const URL = process.env.GROWTH_IT_DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

const ADMIN = 'bbbbbbbb-0000-4000-8000-000000000001';
const MANAGER = 'bbbbbbbb-0000-4000-8000-000000000002';
const SALES = 'bbbbbbbb-0000-4000-8000-000000000003';
const OTHER_SALES = 'bbbbbbbb-0000-4000-8000-000000000004';

const perms = (role: ValidRoles) =>
  GROWTH_ROLES.find((r) => r.name === role)!.permissions;
const actor = (
  sub: string,
  roles: ValidRoles[],
  permissions: P[] = [],
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
const admin = actor(ADMIN, [ValidRoles.SUPER_ADMIN_ROL]);
const manager = actor(
  MANAGER,
  [ValidRoles.GROWTH_MANAGER_ROL],
  perms(ValidRoles.GROWTH_MANAGER_ROL),
);
const sales = actor(SALES, [ValidRoles.SALES_ROL], perms(ValidRoles.SALES_ROL));
const otherSales = actor(
  OTHER_SALES,
  [ValidRoles.SALES_ROL],
  perms(ValidRoles.SALES_ROL),
);
const compliance = actor(ADMIN, [ValidRoles.SUPER_ADMIN_ROL]);

async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  await expect(promise).rejects.toBeInstanceOf(QueryFailedError);
  await expect(promise).rejects.toThrow(pattern);
}

describeDb('EntryLink Prospect (1A) — base de datos real', () => {
  let ds: DataSource;
  let sourceId: string;
  let s: {
    activity: ActivityLogService;
    guards: ProspectGuardsService;
    evidences: EvidencesService;
    suppressions: SuppressionsService;
    channels: ChannelsService;
    orgs: OrganizationsService;
    people: PeopleService;
    props: PropertiesService;
    rel: RelationshipsService;
    validation: ValidationService;
    assignments: AssignmentsService;
    legal: LegalBasisService;
    dashboard: ProspectDashboardService;
  };
  const src = () => ({
    sourceId,
    consultedAt: new Date(),
    reliability: GrowthEvidenceReliability.HIGH,
    url: 'https://www.rues.org.co',
  });

  /** Verifica (como MANAGER) todas las evidencias de un registro. */
  async function verifyAll(entityType: GrowthEntityType, entityId: string) {
    const list = await ds
      .getRepository(Evidence)
      .find({ where: { entityType, entityId } });
    for (const e of list) {
      if (e.verificationStatus === GrowthEvidenceStatus.UNVERIFIED) {
        await s.evidences.verify(
          e.id,
          { status: GrowthEvidenceStatus.VERIFIED },
          manager,
        );
      }
    }
  }

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
      ],
      synchronize: false,
    });
    await ds.initialize();
    await resetGrowthTestData(ds, ['aaaaaaaa-', 'bbbbbbbb-']);

    for (const [id, phone] of [
      [ADMIN, '3008880001'],
      [MANAGER, '3008880002'],
      [SALES, '3008880003'],
      [OTHER_SALES, '3008880004'],
    ]) {
      await ds.query(
        `INSERT INTO public.users (id, name, last_name, number_phone, email, password)
         VALUES ($1, 'Prueba', 'Prospect', $2, $3, 'x')`,
        [id, phone, `${id}@alternaqj.com`],
      );
    }
    // Fuente con revisión jurídica aprobada y activa (requisito para capturar).
    await ds.query(
      `UPDATE growth.data_sources SET legal_review_status = 'APPROVED', legal_review_reference = 'Concepto IT',
              legal_reviewed_by_user_id = $1, legal_reviewed_at = now(), status = 'ACTIVE'
        WHERE code = 'MANUAL_RESEARCH'`,
      [ADMIN],
    );
    // (UPDATE ... RETURNING en TypeORM devuelve [filas, conteo]: se consulta aparte.)
    [{ id: sourceId }] = await ds.query(
      `SELECT id FROM growth.data_sources WHERE code = 'MANUAL_RESEARCH'`,
    );

    const activity = new ActivityLogService(ds.getRepository(ActivityEvent));
    const hashes = new GrowthHashService({
      get: (k: string) =>
        k === 'GROWTH_SUPPRESSION_HMAC_KEYS'
          ? `1:${Buffer.alloc(32, 9).toString('base64')}`
          : '1',
    } as unknown as ConfigService);
    const guards = new ProspectGuardsService(ds, activity);
    const evidences = new EvidencesService(ds, guards, activity);
    const suppressions = new SuppressionsService(ds, hashes, activity);
    s = {
      activity,
      guards,
      evidences,
      suppressions,
      channels: new ChannelsService(
        ds,
        guards,
        evidences,
        suppressions,
        activity,
      ),
      orgs: new OrganizationsService(ds, guards, evidences, activity),
      people: new PeopleService(ds, guards, evidences, activity),
      props: new PropertiesService(ds, guards, evidences, activity),
      rel: new RelationshipsService(ds, guards, evidences, activity),
      validation: new ValidationService(ds, guards, evidences, activity),
      assignments: new AssignmentsService(ds, guards, activity),
      legal: new LegalBasisService(ds, guards, activity),
      dashboard: new ProspectDashboardService(ds, activity),
    };
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  describe('fuentes y evidencias', () => {
    it('no se registra nada con una fuente sin revisión jurídica (no ACTIVE)', async () => {
      const [{ id: pending }] = await ds.query(
        `SELECT id FROM growth.data_sources WHERE code = 'RUES'`,
      );
      await expect(
        s.orgs.create(
          {
            legalName: 'Sin Fuente SAS',
            source: { ...src(), sourceId: pending },
          },
          sales,
        ),
      ).rejects.toThrow('no está activa');
    });

    it('cada campo informado queda con su evidencia; las evidencias no se borran', async () => {
      const org = await s.orgs.create(
        {
          legalName: 'Evidencias SAS',
          nit: '900.123.456',
          address: 'Cra. 15 # 93-47 Of 301',
          source: src(),
        },
        sales,
      );
      const evidences = await ds
        .getRepository(Evidence)
        .find({ where: { entityId: org.id } });
      expect(evidences.map((e) => e.field).sort()).toEqual([
        'address',
        'legalName',
        'nit',
      ]);
      expect(org.addressNormalized).toBe('KR 15 93 47');
      expect(org.nitCheckDigit).toBe('8');
      await expectDbError(
        ds.query(`DELETE FROM growth.evidences WHERE id = $1`, [
          evidences[0].id,
        ]),
        /append-only/,
      );
    });

    it('NIT único y dígito de verificación coherente', async () => {
      await expect(
        s.orgs.create(
          { legalName: 'Duplicada', nit: '900123456', source: src() },
          sales,
        ),
      ).rejects.toThrow('Ya existe una empresa con ese NIT');
      await expect(
        s.orgs.create(
          { legalName: 'DV Malo', nit: '800197268-1', source: src() },
          sales,
        ),
      ).rejects.toThrow('dígito de verificación');
    });
  });

  describe('validación: trigger de transiciones y separación de funciones', () => {
    it('la base rechaza saltar de NEW a VALIDATED aunque se omita el servicio', async () => {
      const org = await s.orgs.create(
        { legalName: 'Salto Ilegal SAS', source: src() },
        sales,
      );
      await expectDbError(
        ds.query(
          `UPDATE growth.organizations SET validation_status = 'VALIDATED', validated_by_user_id = $2, validated_at = now() WHERE id = $1`,
          [org.id, MANAGER],
        ),
        /transición de validación NEW -> VALIDATED no permitida/,
      );
    });

    it('quien registró no toma la validación (usuario normal)', async () => {
      const org = await s.orgs.create(
        { legalName: 'Autovalidación SAS', source: src() },
        manager,
      );
      await s.validation.submit({ kind: K.ORGANIZATION, id: org.id }, manager);
      await expect(
        s.validation.take({ kind: K.ORGANIZATION, id: org.id }, manager),
      ).rejects.toThrow('separación de funciones');
    });

    it('SUPER_ADMIN puede (excepción activa) y queda auditado; desactivada, no puede', async () => {
      const org = await s.orgs.create(
        { legalName: 'Excepción Admin SAS', source: src() },
        admin,
      );
      await s.validation.submit({ kind: K.ORGANIZATION, id: org.id }, admin);
      await s.validation.take({ kind: K.ORGANIZATION, id: org.id }, admin);
      const [ev] = await ds.query(
        `SELECT actor_user_id, changes FROM growth.activity_events WHERE action = 'SELF_VALIDATION_EXCEPTION' AND entity_id = $1`,
        [org.id],
      );
      expect(ev.actor_user_id).toBe(ADMIN);
      expect(ev.changes).toEqual({
        operation: 'VALIDATION_TAKEN',
        userId: ADMIN,
      });

      await s.dashboard.updateSettings(
        { allowSuperAdminSelfValidation: false },
        admin,
      );
      await s.validation.release({ kind: K.ORGANIZATION, id: org.id }, admin);
      await expect(
        s.validation.take({ kind: K.ORGANIZATION, id: org.id }, admin),
      ).rejects.toThrow('separación de funciones');
      await s.dashboard.updateSettings(
        { allowSuperAdminSelfValidation: true },
        admin,
      );
    });

    it('empresa: VALIDATED solo con requisitos completos (evidencias verificadas, canal corporativo, copropiedad)', async () => {
      const org = await s.orgs.create(
        {
          legalName: 'Administraciones Andes SAS',
          nit: '901000001',
          source: src(),
        },
        sales,
      );
      const ref = { kind: K.ORGANIZATION, id: org.id };
      await s.validation.submit(ref, sales);
      await s.validation.take(ref, manager);
      await expect(
        s.validation.decide(
          ref,
          { decision: GrowthValidationDecision.VALIDATED },
          manager,
        ),
      ).rejects.toThrow('Faltan requisitos');

      const channel = await s.channels.addToOrganization(
        org.id,
        {
          kind: GrowthChannelKind.EMAIL,
          value: 'contacto@andes.co',
          source: src(),
        },
        sales,
      );
      await s.channels.verify(K.ORGANIZATION, channel.id, manager);
      const property = await s.props.create(
        {
          name: 'Conjunto Residencial Los Pinos',
          address: 'Calle 100 # 15-20',
          locality: 'USAQUEN' as never,
          estimatedUnits: 120,
          source: src(),
        },
        sales,
      );
      await s.rel.setPropertyManager(
        {
          propertyId: property.id,
          managerType: GrowthManagerType.ORGANIZATION,
          organizationId: org.id,
          status: GrowthRelationStatus.CURRENT,
          source: src(),
        },
        sales,
      );
      await verifyAll(GrowthEntityType.ORGANIZATION, org.id);

      const checklist = await s.validation.checklist(ref, manager);
      expect(checklist.ready).toBe(true);
      const decided = await s.validation.decide(
        ref,
        { decision: GrowthValidationDecision.VALIDATED },
        manager,
      );
      expect(decided.validationStatus).toBe('VALIDATED');

      // Cambiar el NIT de una empresa validada la devuelve a revisión.
      const changed = await s.orgs.update(
        org.id,
        { nit: '901000002', source: src() },
        sales,
      );
      expect(changed.validationStatus).toBe('PENDING_REVIEW');
    });

    it('quien capturó una evidencia no la verifica', async () => {
      const org = await s.orgs.create(
        { legalName: 'Captura Propia SAS', source: src() },
        manager,
      );
      const [e] = await ds
        .getRepository(Evidence)
        .find({ where: { entityId: org.id } });
      await expect(
        s.evidences.verify(
          e.id,
          { status: GrowthEvidenceStatus.VERIFIED },
          manager,
        ),
      ).rejects.toThrow('separación de funciones');
    });
  });

  describe('bloqueo jurídico (PENDING_LEGAL_REVIEW)', () => {
    let personId: string;

    beforeAll(async () => {
      const person = await s.people.create(
        {
          fullName: 'Ana María Gómez',
          isIndependentAdmin: true,
          source: src(),
        },
        sales,
      );
      personId = person.id;
    });

    it('la persona nace pendiente, sin contacto y con finalidad trazable', async () => {
      const p = await ds
        .getRepository(Person)
        .findOneByOrFail({ id: personId });
      expect(p.legalBasis).toBe(GrowthLegalBasis.PENDING_LEGAL_REVIEW);
      expect(p.contactStatus).toBe(GrowthContactStatus.NOT_AUTHORIZED);
      expect(p.processingPurpose).toMatch(/B2B/);
      const diffDays =
        (p.retentionReviewAt.getTime() - p.createdAt.getTime()) / 86_400_000;
      expect(diffDays).toBeGreaterThan(364);
      expect(diffDays).toBeLessThan(367);
    });

    it('la BASE impide autorizar contacto con base pendiente, aunque se omita el servicio', async () => {
      await expectDbError(
        ds.query(
          `UPDATE growth.people SET contact_status = 'AUTHORIZED', contact_authorized_by_user_id = $2, contact_authorized_at = now() WHERE id = $1`,
          [personId, ADMIN],
        ),
        /ck_growth_people_contact_requires_basis/,
      );
    });

    it('el servicio también lo impide', async () => {
      await expect(
        s.legal.setContactStatus(
          personId,
          {
            status: GrowthContactStatus.AUTHORIZED,
            reason: 'Intento sin base jurídica',
          },
          compliance,
        ),
      ).rejects.toThrow('pendiente de revisión');
    });

    it('administrador independiente: un canal DIRECT verificado no basta con base pendiente; uno PROFESSIONAL sí', async () => {
      const property = await s.props.create(
        {
          name: 'Edificio Torre Norte',
          address: 'KR 7 # 120-30',
          locality: 'USAQUEN' as never,
          source: src(),
        },
        sales,
      );
      await s.rel.setPropertyManager(
        {
          propertyId: property.id,
          managerType: GrowthManagerType.PERSON,
          personId,
          status: GrowthRelationStatus.CURRENT,
          source: src(),
        },
        sales,
      );
      const direct = await s.channels.addToPerson(
        personId,
        {
          kind: GrowthChannelKind.PHONE,
          value: '300 111 2233',
          channelClass: GrowthChannelClass.DIRECT,
          source: src(),
        },
        sales,
      );
      await s.channels.verify(K.PERSON, direct.id, manager);
      await verifyAll(GrowthEntityType.PERSON, personId);

      const ref = { kind: K.PERSON, id: personId };
      let checklist = await s.validation.checklist(ref, manager);
      expect(checklist.items.find((i) => i.key === 'channel')!.ok).toBe(false);

      const pro = await s.channels.addToPerson(
        personId,
        {
          kind: GrowthChannelKind.EMAIL,
          value: 'ana.gomez@adminph.co',
          channelClass: GrowthChannelClass.PROFESSIONAL,
          source: src(),
        },
        sales,
      );
      await s.channels.verify(K.PERSON, pro.id, manager);
      checklist = await s.validation.checklist(ref, manager);
      expect(checklist.ready).toBe(true);

      await s.validation.submit(ref, sales);
      await s.validation.take(ref, manager);
      await s.validation.decide(
        ref,
        { decision: GrowthValidationDecision.VALIDATED },
        manager,
      );
    });

    it('validar NO autoriza contacto; con base documentada y autorización sí, y la vista lo refleja', async () => {
      const contactable = () =>
        ds.query(
          `SELECT channel_id FROM growth.v_contactable_person_channels WHERE person_id = $1`,
          [personId],
        );
      expect(await contactable()).toEqual([]);

      await s.legal.setLegalBasis(
        personId,
        {
          legalBasis: GrowthLegalBasis.PRIOR_AUTHORIZATION,
          reference: 'Autorización escrita RAD-2026-77',
        },
        compliance,
      );
      expect(await contactable()).toEqual([]); // base válida pero sin autorización de contacto

      await s.legal.setContactStatus(
        personId,
        {
          status: GrowthContactStatus.AUTHORIZED,
          reason: 'Autorización escrita del titular',
        },
        compliance,
      );
      expect((await contactable()).length).toBe(2);

      // Volver a pendiente revoca en la misma operación.
      const back = await s.legal.setLegalBasis(
        personId,
        { legalBasis: GrowthLegalBasis.PENDING_LEGAL_REVIEW },
        compliance,
      );
      expect(back.contactStatus).toBe(GrowthContactStatus.REVOKED);
      expect(await contactable()).toEqual([]);
    });

    it('base distinta de pendiente sin referencia: rechazada por la base', async () => {
      await expectDbError(
        ds.query(
          `UPDATE growth.people SET legal_basis = 'PUBLIC_DATA' WHERE id = $1`,
          [personId],
        ),
        /ck_growth_people_legal_trace/,
      );
    });
  });

  describe('lista de exclusión antes de almacenar canales', () => {
    it('un correo excluido no se guarda y el evento no contiene el dato', async () => {
      await s.suppressions.add(
        {
          identifierType: GrowthIdentifierType.EMAIL,
          value: 'no.molestar@correo.co',
          scope: GrowthSuppressionScope.ALL_CHANNELS,
          reason: GrowthSuppressionReason.UNSUBSCRIBE,
        },
        admin,
      );
      const person = await s.people.create(
        {
          fullName: 'Persona Excluida',
          isIndependentAdmin: false,
          source: src(),
        },
        sales,
      );
      await expect(
        s.channels.addToPerson(
          person.id,
          {
            kind: GrowthChannelKind.EMAIL,
            value: 'No.Molestar@correo.co',
            channelClass: GrowthChannelClass.DIRECT,
            source: src(),
          },
          sales,
        ),
      ).rejects.toThrow('lista de exclusión');
      const stored = await ds.query(
        `SELECT count(*)::int AS n FROM growth.person_channels WHERE person_id = $1`,
        [person.id],
      );
      expect(stored[0].n).toBe(0);
      const [ev] = await ds.query(
        `SELECT changes::text AS c FROM growth.activity_events WHERE action = 'CHANNEL_REJECTED_SUPPRESSED' AND entity_id = $1`,
        [person.id],
      );
      expect(ev.c).not.toMatch(/molestar/i);
    });

    it('un dominio excluido bloquea los correos de ese dominio', async () => {
      await s.suppressions.add(
        {
          identifierType: GrowthIdentifierType.DOMAIN,
          value: 'bloqueada.co',
          scope: GrowthSuppressionScope.ALL_CHANNELS,
          reason: GrowthSuppressionReason.SUBJECT_REQUEST,
        },
        admin,
      );
      const org = await s.orgs.create(
        { legalName: 'Dominio Bloqueado SAS', source: src() },
        sales,
      );
      await expect(
        s.channels.addToOrganization(
          org.id,
          {
            kind: GrowthChannelKind.EMAIL,
            value: 'info@bloqueada.co',
            source: src(),
          },
          sales,
        ),
      ).rejects.toThrow('lista de exclusión');
    });
  });

  describe('historiales', () => {
    it('una sola administración vigente: la nueva CURRENT cierra la anterior; la base impide dos', async () => {
      const property = await s.props.create(
        { name: 'Agrupación El Bosque', source: src() },
        sales,
      );
      const a = await s.orgs.create(
        { legalName: 'Admin Uno SAS', source: src() },
        sales,
      );
      const b = await s.orgs.create(
        { legalName: 'Admin Dos SAS', source: src() },
        sales,
      );
      const first = await s.rel.setPropertyManager(
        {
          propertyId: property.id,
          managerType: GrowthManagerType.ORGANIZATION,
          organizationId: a.id,
          startedOn: '2024-01-01',
          status: GrowthRelationStatus.CURRENT,
          source: src(),
        },
        sales,
      );
      await s.rel.setPropertyManager(
        {
          propertyId: property.id,
          managerType: GrowthManagerType.ORGANIZATION,
          organizationId: b.id,
          startedOn: '2026-03-01',
          status: GrowthRelationStatus.CURRENT,
          source: src(),
        },
        sales,
      );
      const history = await s.rel.managementsOfProperty(property.id);
      expect(history.map((h) => h.status).sort()).toEqual(['CURRENT', 'PAST']);
      expect(history.find((h) => h.id === first.id)!.endedOn).toBe(
        '2026-03-01',
      );

      await expectDbError(
        ds.query(
          `INSERT INTO growth.property_managements (property_id, manager_type, organization_id, status, source_id, created_by_user_id)
           VALUES ($1, 'ORGANIZATION', $2, 'CURRENT', $3, $4)`,
          [property.id, a.id, sourceId, SALES],
        ),
        /uq_growth_pm_current/,
      );
      await expectDbError(
        ds.query(
          `INSERT INTO growth.property_managements (property_id, manager_type, person_id, organization_id, status, source_id, created_by_user_id)
           VALUES ($1, 'PERSON', NULL, $2, 'UNCONFIRMED', $3, $4)`,
          [property.id, a.id, sourceId, SALES],
        ),
        /ck_growth_pm_coherence/,
      );
    });

    it('una persona puede tener vínculos con varias empresas en el tiempo', async () => {
      const person = await s.people.create(
        { fullName: 'Carlos Ruiz', isIndependentAdmin: false, source: src() },
        sales,
      );
      const a = await s.orgs.create(
        { legalName: 'Empresa A SAS', source: src() },
        sales,
      );
      const b = await s.orgs.create(
        { legalName: 'Empresa B SAS', source: src() },
        sales,
      );
      const e1 = await s.rel.linkEmployment(
        {
          personId: person.id,
          organizationId: a.id,
          startedOn: '2020-01-01',
          status: GrowthRelationStatus.CURRENT,
          source: src(),
        },
        sales,
      );
      await s.rel.endEmployment(e1.id, { endedOn: '2023-06-30' }, sales);
      await s.rel.linkEmployment(
        {
          personId: person.id,
          organizationId: b.id,
          startedOn: '2023-07-01',
          status: GrowthRelationStatus.CURRENT,
          source: src(),
        },
        sales,
      );
      await s.rel.linkEmployment(
        {
          personId: person.id,
          organizationId: a.id,
          startedOn: '2026-01-01',
          status: GrowthRelationStatus.UNCONFIRMED,
          source: src(),
        },
        sales,
      );
      const list = await s.rel.employmentsOfPerson(person.id);
      expect(list).toHaveLength(3);
    });

    it('asignaciones: reasignar conserva el historial; la base impide dos vigentes', async () => {
      await ds.query(
        `INSERT INTO growth.team_members (user_id, display_name) VALUES ($1, 'Ventas'), ($2, 'Ventas 2')`,
        [SALES, OTHER_SALES],
      );
      const [m1] = await ds.query(
        `SELECT id FROM growth.team_members WHERE user_id = $1`,
        [SALES],
      );
      const [m2] = await ds.query(
        `SELECT id FROM growth.team_members WHERE user_id = $1`,
        [OTHER_SALES],
      );
      const org = await s.orgs.create(
        { legalName: 'Asignable SAS', source: src() },
        manager,
      );
      const ref = { kind: K.ORGANIZATION, id: org.id };
      await s.assignments.assign(
        { prospect: ref, teamMemberId: m1.id },
        manager,
      );
      await s.assignments.assign(
        { prospect: ref, teamMemberId: m2.id, reason: 'Cambio de territorio' },
        manager,
      );
      const history = await s.assignments.history(ref, manager);
      expect(history).toHaveLength(2);
      expect(history.filter((h) => !h.endedAt)).toHaveLength(1);
      await expectDbError(
        ds.query(
          `INSERT INTO growth.prospect_assignments (organization_id, team_member_id, assigned_by_user_id) VALUES ($1, $2, $3)`,
          [org.id, m1.id, MANAGER],
        ),
        /uq_growth_assign_org/,
      );
    });
  });

  describe('visibilidad', () => {
    it('sin VIEW_ALL solo se ve lo propio o lo asignado; lo ajeno responde NOT_FOUND', async () => {
      const mine = await s.orgs.create(
        { legalName: 'Visible Propia SAS', source: src() },
        otherSales,
      );
      await expect(s.orgs.get(mine.id, sales)).rejects.toThrow('no encontrado');
      expect((await s.orgs.get(mine.id, otherSales)).id).toBe(mine.id);
      expect((await s.orgs.get(mine.id, manager)).id).toBe(mine.id); // VIEW_ALL

      const [m1] = await ds.query(
        `SELECT id FROM growth.team_members WHERE user_id = $1`,
        [SALES],
      );
      await s.assignments.assign(
        {
          prospect: { kind: K.ORGANIZATION, id: mine.id },
          teamMemberId: m1.id,
        },
        manager,
      );
      expect((await s.orgs.get(mine.id, sales)).id).toBe(mine.id);

      const list = await s.orgs.list(sales, {}, { page: 1, limit: 100 });
      expect(
        list.items.every(
          (o) => o.createdByUserId === SALES || o.id === mine.id,
        ),
      ).toBe(true);
    });
  });

  describe('dashboard y configuración', () => {
    it('cuenta prospectos validados y distingue unidades verificadas de estimadas', async () => {
      const d = await s.dashboard.dashboard(manager);
      expect(d.goal).toBe(100);
      expect(d.validatedProspects).toBeGreaterThanOrEqual(1);
      expect(d.estimatedUnits).toBeGreaterThanOrEqual(120);
      expect(d.recentActivity.length).toBeGreaterThan(0);
    });

    it('la configuración no se borra', async () => {
      await expectDbError(
        ds.query(`DELETE FROM growth.settings`),
        /no se borra/,
      );
    });
  });
});

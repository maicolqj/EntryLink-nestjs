/**
 * Integración de la entrega 1C (importaciones CSV/XLSX) contra Postgres REAL.
 * Solo base desechable (ver docs/growth/TESTING.md). La cola se sustituye por
 * una captura: los trabajos se ejecutan aquí, en orden, con el mismo código
 * del procesador.
 */
import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { DataSource, QueryFailedError } from 'typeorm';
import { ValidPermissions as P } from '../../src/modules/permissions/enums/valid-permissions';
import { ValidRoles } from '../../src/modules/roles/enums/valid-roles';
import { JwtAccessPayload } from '../../src/modules/shared/interfaces/jwt-payload.interface';
import { ActivityEvent } from '../../src/modules/growth/activity/entities/activity-event.entity';
import { ActivityLogService } from '../../src/modules/growth/activity/services/activity-log.service';
import { LegalHold } from '../../src/modules/growth/compliance/entities/legal-hold.entity';
import { Suppression } from '../../src/modules/growth/compliance/entities/suppression.entity';
import { SuppressionHash } from '../../src/modules/growth/compliance/entities/suppression-hash.entity';
import { SuppressionsService } from '../../src/modules/growth/compliance/services/suppressions.service';
import {
  GrowthIdentifierType,
  GrowthSuppressionReason,
  GrowthSuppressionScope,
} from '../../src/modules/growth/shared/growth.enums';
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
  GrowthEvidenceReliability,
  GrowthProspectKind as K,
} from '../../src/modules/growth/prospects/prospects.enums';
import { ChannelsService } from '../../src/modules/growth/prospects/services/channels.service';
import { EvidencesService } from '../../src/modules/growth/prospects/services/evidences.service';
import { OrganizationsService } from '../../src/modules/growth/prospects/services/organizations.service';
import { PeopleService } from '../../src/modules/growth/prospects/services/people.service';
import { PropertiesService } from '../../src/modules/growth/prospects/services/properties.service';
import { ProspectEventsService } from '../../src/modules/growth/prospects/services/prospect-events.service';
import { ProspectGuardsService } from '../../src/modules/growth/prospects/services/prospect-guards.service';
import {
  ImportBatch,
  ImportMappingTemplate,
  ImportRow,
} from '../../src/modules/growth/imports/entities/import.entities';
import {
  GrowthImportDecision as D,
  GrowthImportField as F,
  GrowthImportRowResult as R,
  GrowthImportStatus as S,
  GrowthImportTarget as T,
  GrowthImportTemplateScope as Scope,
} from '../../src/modules/growth/imports/imports.enums';
import { ImportCommitService } from '../../src/modules/growth/imports/services/import-commit.service';
import { ImportJobsProcessor } from '../../src/modules/growth/imports/services/import-jobs.processor';
import { ImportPurgeService } from '../../src/modules/growth/imports/services/import-purge.service';
import {
  GrowthImportJob,
  ImportQueueService,
} from '../../src/modules/growth/imports/services/import-queue.service';
import { ImportRedactionService } from '../../src/modules/growth/imports/services/import-redaction.service';
import { ImportValidationService } from '../../src/modules/growth/imports/services/import-validation.service';
import { ImportsService } from '../../src/modules/growth/imports/services/imports.service';
import { ImportTemplatesService } from '../../src/modules/growth/imports/services/import-templates.service';
import { resetGrowthTestData } from './db-cleanup';

const URL = process.env.GROWTH_IT_DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

const ADMIN = 'dddddddd-0000-4000-8000-000000000001';
const LIMITED = 'dddddddd-0000-4000-8000-000000000002';
const MANAGER = 'dddddddd-0000-4000-8000-000000000003';

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
const admin = actor(ADMIN, [ValidRoles.SUPER_ADMIN_ROL], []);
/** Importa, pero no ve todo ni datos de contacto en claro. */
const limited = actor(
  LIMITED,
  [ValidRoles.GROWTH_RESEARCHER_ROL],
  [P.IMPORT_GROWTH_DATA, P.EDIT_GROWTH_PROSPECTS, P.VIEW_GROWTH_PROSPECTS],
);

/** DV DIAN de un NIT (misma fórmula que la app). */
function dv(nit: string): string {
  const w = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  const sum = nit
    .split('')
    .reverse()
    .reduce((a, d, i) => a + Number(d) * w[i], 0);
  const m = sum % 11;
  return String(m > 1 ? 11 - m : m);
}
const nitOf = (i: number) => String(800000000 + i);

async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  await expect(promise).rejects.toBeInstanceOf(QueryFailedError);
  await expect(promise).rejects.toThrow(pattern);
}

describeDb('Prospect 1C — importaciones (base real)', () => {
  let ds: DataSource;
  let sourceId: string;
  let imports: ImportsService;
  let templates: ImportTemplatesService;
  let processor: ImportJobsProcessor;
  let purge: ImportPurgeService;
  let orgs: OrganizationsService;
  let suppressions: SuppressionsService;
  const queued: Array<{ name: string; data: GrowthImportJob }> = [];
  const changed: Array<{ kind: K; id: string }> = [];

  /** Ejecuta los trabajos encolados como lo haría el worker. */
  const drain = async () => {
    while (queued.length) {
      const job = queued.shift()!;
      await processor.process({ name: job.name, data: job.data } as never);
    }
  };
  const upload = (
    content: string | Buffer,
    target = T.ORGANIZATIONS,
    who = admin,
    name = 'empresas.csv',
  ) =>
    imports.upload(
      {
        buffer: Buffer.isBuffer(content)
          ? content
          : Buffer.from(content, 'utf8'),
        originalname: name,
      },
      {
        target,
        sourceId,
        consultedAt: new Date(Date.now() - 3600_000),
        reliability: GrowthEvidenceReliability.MEDIUM,
      },
      who,
    );
  const rowsOf = (batchId: string) =>
    ds
      .getRepository(ImportRow)
      .find({ where: { batchId }, order: { rowNumber: 'ASC' } });

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
        LegalHold,
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
        ImportBatch,
        ImportRow,
        ImportMappingTemplate,
      ],
      synchronize: false,
    });
    await ds.initialize();
    await resetGrowthTestData(ds, ['dddddddd-']);
    for (const [id, n] of [
      [ADMIN, 1],
      [LIMITED, 2],
      [MANAGER, 3],
    ] as const) {
      await ds.query(
        `INSERT INTO public.users (id, name, last_name, number_phone, email, password)
         VALUES ($1, 'Import', 'IT', $2, $3, 'x')`,
        [id, `300666000${n}`, `import-it-${n}@alternaqj.com`],
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
          ? `1:${Buffer.alloc(32, 7).toString('base64')}`
          : '1',
    } as unknown as ConfigService);
    const guards = new ProspectGuardsService(ds, activity);
    const evidences = new EvidencesService(ds, guards, activity);
    suppressions = new SuppressionsService(ds, hashes, activity);
    const channels = new ChannelsService(
      ds,
      guards,
      evidences,
      suppressions,
      activity,
    );
    orgs = new OrganizationsService(ds, guards, evidences, activity);
    const people = new PeopleService(ds, guards, evidences, activity);
    const props = new PropertiesService(ds, guards, evidences, activity);
    const events = {
      changed: (kind: K, id: string) => {
        changed.push({ kind, id });
        return Promise.resolve();
      },
    } as unknown as ProspectEventsService;
    const queue = {
      enqueue: (name: string, data: GrowthImportJob) => {
        queued.push({ name, data });
        return Promise.resolve();
      },
    } as unknown as ImportQueueService;

    const redaction = new ImportRedactionService(suppressions);
    templates = new ImportTemplatesService(ds, activity, redaction);
    imports = new ImportsService(
      ds,
      guards,
      activity,
      queue,
      redaction,
      templates,
    );
    const validation = new ImportValidationService(ds, redaction, activity);
    const commit = new ImportCommitService(
      ds,
      orgs,
      people,
      props,
      channels,
      evidences,
      guards,
      events,
      activity,
    );
    processor = new ImportJobsProcessor(validation, commit, imports);
    purge = new ImportPurgeService(ds, activity);
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  describe('lote de 500 empresas con errores, duplicados y exclusiones sembrados', () => {
    let batch: ImportBatch;
    let csvText: string;
    const existing: string[] = [];

    beforeAll(async () => {
      // 5 empresas ya registradas: sus NIT aparecen en el archivo.
      for (let i = 0; i < 5; i++) {
        existing.push(
          (
            await orgs.create(
              {
                legalName: `Existente ${i}`,
                nit: nitOf(1000 + i),
                source: {
                  sourceId,
                  consultedAt: new Date(),
                  reliability: GrowthEvidenceReliability.HIGH,
                },
              },
              admin,
            )
          ).id,
        );
      }
      // 3 correos en la lista de exclusión.
      for (let i = 0; i < 3; i++) {
        await suppressions.add(
          {
            identifierType: GrowthIdentifierType.EMAIL,
            value: `excluido${i}@empresa${i}.co`,
            scope: GrowthSuppressionScope.ALL_CHANNELS,
            reason: GrowthSuppressionReason.UNSUBSCRIBE,
          },
          admin,
        );
      }

      const lines = [
        'Razón social;NIT;Correo;Teléfono;Localidad;Columna libre',
      ];
      for (let i = 0; i < 500; i++) {
        let name = `Administraciones Prueba ${i} SAS`;
        let nit = `${nitOf(i)}-${dv(nitOf(i))}`;
        let email = `contacto${i}@admin${i}.co`;
        const phone = `310${String(1000000 + i)}`;
        if (i < 20)
          nit = `${nitOf(i)}-${(Number(dv(nitOf(i))) + 1) % 10}`; // 20 DV errados
        else if (i < 30)
          name = ''; // 10 sin nombre
        else if (i < 40)
          email = 'sin-arroba'; // 10 correos inválidos
        else if (i < 45)
          nit = `${nitOf(1000 + (i - 40))}`; // 5 NIT que ya existen
        else if (i < 50)
          nit = `${nitOf(100)}-${dv(nitOf(100))}`; // 5 repiten el NIT de la fila 100
        else if (i < 53) email = `excluido${i - 50}@empresa${i - 50}.co`; // 3 excluidos
        lines.push(
          [
            name,
            nit,
            email,
            phone,
            i % 2 ? 'Suba' : 'chapinero',
            '=HYPERLINK("http://malo")',
          ].join(';'),
        );
      }
      csvText = lines.join('\r\n');
      batch = await upload(csvText);
    });

    it('al subir: el archivo no se guarda, los excluidos llegan redactados y hay mapeo sugerido', async () => {
      expect(batch.status).toBe(S.UPLOADED);
      expect(batch.totalRows).toBe(500);
      expect(batch.headers[0]).toBe('Razón social');
      expect(batch.fileSha256).toMatch(/^[0-9a-f]{64}$/);
      // No existe ninguna tabla para el archivo original.
      const [{ t }] = await ds.query(
        `SELECT to_regclass('growth.import_files')::text AS t`,
      );
      expect(t).toBeNull();
      // Los 3 correos excluidos se redactaron antes de guardar las filas.
      expect(batch.suppressedValues).toBe(3);
      const rows = await rowsOf(batch.id);
      expect(rows[50].raw![2]).toBe('[excluido]');
      expect(JSON.stringify(rows.map((r) => r.raw))).not.toMatch(
        /excluido\d@empresa/,
      );
      const preview = await imports.preview(batch.id, admin);
      expect(preview.rows).toHaveLength(20);
      expect(preview.suggestedMapping).toEqual([
        { column: 0, field: F.LEGAL_NAME },
        { column: 1, field: F.NIT },
        { column: 2, field: F.EMAIL },
        { column: 3, field: F.PHONE },
        { column: 4, field: F.LOCALITY },
      ]);
    });

    it('valida en la cola: errores, duplicados y exclusiones contados', async () => {
      const preview = await imports.preview(batch.id, admin);
      await imports.map(
        {
          batchId: batch.id,
          mapping: preview.suggestedMapping,
          saveAsTemplate: 'Directorio IT',
        },
        admin,
      );
      expect(queued).toHaveLength(1);
      await drain();
      const b = await imports.get(batch.id, admin);
      expect(b.status).toBe(S.VALIDATED);
      expect(b.errorRows).toBe(40);
      expect(b.validRows).toBe(460);
      expect(b.suppressedValues).toBe(3);

      const rows = await rowsOf(batch.id);
      const at = (i: number) => rows[i];
      expect(at(0).errors).toEqual([{ field: 'nit', code: 'NIT_CHECK_DIGIT' }]);
      expect(at(25).errors).toEqual([{ field: 'legalName', code: 'REQUIRED' }]);
      expect(at(35).decision).toBe(D.SKIP);
      // NIT existente → vincular al registro, sin crear.
      expect(at(40).decision).toBe(D.LINK_EXISTING);
      expect(at(40).linkEntityId).toBe(existing[0]);
      // Repetido dentro del archivo (la fila 100 aparece después: se salta la posterior).
      expect(at(100).decision).toBe(D.SKIP);
      expect(at(100).warnings).toContainEqual({ code: 'DUPLICATE_IN_FILE' });
      expect(at(45).decision).toBe(D.CREATE);
      // Excluido: el correo no queda en ninguna parte.
      expect(at(50).warnings).toContainEqual({
        field: 'email',
        code: 'SUPPRESSED',
      });
      expect(at(50).mapped).not.toHaveProperty('email');
      expect(at(50).errors).toEqual([]);
      const tpl = await templates.list(T.ORGANIZATIONS, admin);
      expect(tpl.map((t) => t.name)).toContain('Directorio IT');
    });

    it('la base no deja marcar CREATE una fila con errores; el servicio tampoco', async () => {
      const [bad] = await rowsOf(batch.id);
      await expectDbError(
        ds.query(
          `UPDATE growth.import_rows SET decision = 'CREATE' WHERE id = $1`,
          [bad.id],
        ),
        /ck_growth_import_row_create/,
      );
      await expect(
        imports.setRowDecision({ rowId: bad.id, decision: D.CREATE }, admin),
      ).rejects.toThrow(/errores/);
    });

    it('confirma: crea en NEW con evidencia de la fuente, vincula sin cambiar y es idempotente', async () => {
      await imports.commit(batch.id, admin);
      await drain();
      const b = await imports.get(batch.id, admin);
      expect(b.status).toBe(S.COMMITTED);
      expect(b.finishedAt).toBeTruthy();
      // 500 − 40 con errores − 5 vinculadas − 1 repetida en el archivo (fila 100, la 2.ª aparición del NIT de 45..49 es la 46ª…)
      const rows = await rowsOf(batch.id);
      const created = rows.filter((r) => r.result === R.CREATED);
      expect(b.createdRows).toBe(created.length);
      expect(b.linkedRows).toBe(5);
      expect(b.failedRows).toBe(0);
      expect(b.createdRows + b.linkedRows + b.skippedRows).toBe(500);

      const createdOrgs = await ds
        .getRepository(Organization)
        .findBy(created.map((r) => ({ id: r.resultEntityId! })));
      expect(createdOrgs.every((o) => o.validationStatus === 'NEW')).toBe(true);
      const ev = await ds
        .getRepository(Evidence)
        .findBy({ entityId: created[0].resultEntityId! });
      expect(ev.length).toBeGreaterThan(0);
      expect(ev.every((e) => e.sourceId === sourceId)).toBe(true);

      // Excluido: la empresa existe, pero sin ese correo.
      const suppressedRow = rows[50];
      expect(suppressedRow.result).toBe(R.CREATED);
      const ch = await ds
        .getRepository(OrganizationChannel)
        .findBy({ organizationId: suppressedRow.resultEntityId! });
      expect(ch.map((c) => c.kind)).toEqual([GrowthChannelKind.PHONE]);

      // Vinculada: el registro no cambia de nombre; solo gana evidencias.
      const linked = await ds
        .getRepository(Organization)
        .findOneByOrFail({ id: existing[0] });
      expect(linked.legalName).toBe('Existente 0');
      const linkEv = await ds
        .getRepository(Evidence)
        .findBy({ entityId: existing[0], field: 'legalName' });
      expect(linkEv.map((e) => e.observedValue)).toContain(
        'Administraciones Prueba 40 SAS',
      );

      // Duplicados y scoring encolados para cada creado.
      expect(changed.filter((c) => c.kind === K.ORGANIZATION)).toHaveLength(
        created.length,
      );

      // Repetir la confirmación no duplica.
      const before = await ds.getRepository(Organization).count();
      await processor.process({
        name: 'commit',
        data: { batchId: batch.id, actor: admin },
      } as never);
      expect(await ds.getRepository(Organization).count()).toBe(before);
    });

    it('la base no deja retroceder un lote terminado ni borrarlo', async () => {
      await expectDbError(
        ds.query(
          `UPDATE growth.import_batches SET status = 'MAPPED' WHERE id = $1`,
          [batch.id],
        ),
        /transición COMMITTED -> MAPPED/,
      );
      await expectDbError(
        ds.query(`DELETE FROM growth.import_batches WHERE id = $1`, [batch.id]),
        /append-only|no se permite|modific/i,
      );
    });

    it('el informe neutraliza fórmulas y deja actividad sin datos', async () => {
      const { content } = await imports.report(batch.id, admin);
      const ExcelJS = await import('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(content as unknown as ArrayBuffer);
      const filas = wb.getWorksheet('Filas')!;
      expect(filas.rowCount).toBe(501);
      const free = filas.getRow(2).getCell(4 + 6);
      expect(free.formula).toBeUndefined();
      expect(String(free.value)).toMatch(/^'=HYPERLINK/);
      const events: ActivityEvent[] = await ds
        .getRepository(ActivityEvent)
        .findBy({ entityId: batch.id });
      expect(events.map((e) => e.action)).toEqual(
        expect.arrayContaining([
          'IMPORT_UPLOADED',
          'IMPORT_MAPPED',
          'IMPORT_VALIDATED',
          'IMPORT_COMMIT_REQUESTED',
          'IMPORT_COMMITTED',
          'IMPORT_REPORT_DOWNLOADED',
        ]),
      );
      expect(JSON.stringify(events.map((e) => e.changes))).not.toMatch(
        /@admin|empresas\.csv|Prueba/,
      );
    });

    it('un archivo repetido se avisa con los lotes anteriores', async () => {
      const again = await upload(csvText);
      expect((await imports.preview(again.id, admin)).previousBatchIds).toEqual(
        [batch.id],
      );
      await imports.cancel(again.id, 'Archivo repetido', admin);
    });
  });

  /**
   * Plantillas personales y del equipo: solo encabezados y campos, nombres
   * sin sobrescritura, archivado lógico y actividad sin datos.
   */
  describe('plantillas personales y del equipo', () => {
    const manager = actor(
      MANAGER,
      [ValidRoles.GROWTH_MANAGER_ROL],
      [P.IMPORT_GROWTH_DATA, P.MANAGE_GROWTH_IMPORT_TEMPLATES],
    );
    const mapping = [
      { header: 'Razón social', field: F.LEGAL_NAME },
      { header: 'NIT', field: F.NIT },
    ];
    const names = () =>
      Promise.all([
        templates.list(T.ORGANIZATIONS, limited),
        templates.list(T.ORGANIZATIONS, manager),
      ]).then(([l, m]) => [l.map((t) => t.name), m.map((t) => t.name)]);

    it('una personal es solo de su dueño; nadie más la ve, la edita ni la archiva', async () => {
      const mine = await templates.create(
        { target: T.ORGANIZATIONS, name: 'Mía IT', columnMapping: mapping },
        limited,
      );
      expect(mine.scope).toBe(Scope.PERSONAL);
      expect(mine.ownerUserId).toBe(LIMITED);
      const [ofLimited, ofManager] = await names();
      expect(ofLimited).toContain('Mía IT');
      expect(ofManager).not.toContain('Mía IT');
      // Ni con permiso de gestión: responde NOT_FOUND, sin revelar que existe.
      await expect(
        templates.update({ id: mine.id, name: 'Ajena' }, manager),
      ).rejects.toThrow(/no encontrada/);
      await expect(
        templates.archive(mine.id, 'No es mía', manager),
      ).rejects.toThrow(/no encontrada/);
      // Su dueño sí la edita.
      const renamed = await templates.update(
        { id: mine.id, name: 'Mía IT 2' },
        limited,
      );
      expect(renamed.name).toBe('Mía IT 2');
    });

    it('un nombre repetido es un error, nunca una sobrescritura', async () => {
      await templates.create(
        {
          target: T.ORGANIZATIONS,
          name: 'Repetida IT',
          columnMapping: mapping,
        },
        limited,
      );
      await expect(
        templates.create(
          {
            target: T.ORGANIZATIONS,
            name: '  repetida   it ',
            columnMapping: [{ header: 'Otra', field: F.LEGAL_NAME }],
          },
          limited,
        ),
      ).rejects.toThrow(/Ya tienes una plantilla con ese nombre/);
      // El mismo nombre en la personal de otra persona sí se puede.
      const other = await templates.create(
        {
          target: T.ORGANIZATIONS,
          name: 'Repetida IT',
          columnMapping: mapping,
        },
        manager,
      );
      expect(other.ownerUserId).toBe(MANAGER);
      // La de la primera persona sigue intacta.
      const [kept] = (await templates.list(T.ORGANIZATIONS, limited)).filter(
        (t) => t.name === 'Repetida IT',
      );
      expect(kept.columnMapping).toEqual(mapping);
      // Y la base también lo impide si el servicio se saltara.
      await expectDbError(
        ds.query(
          `INSERT INTO growth.import_mapping_templates (target, name, column_mapping, scope, owner_user_id, created_by_user_id)
           VALUES ('ORGANIZATIONS', 'REPETIDA IT', '[{"header":"x","field":"legalName"}]', 'PERSONAL', $1, $1)`,
          [LIMITED],
        ),
        /uq_growth_import_tpl_personal/,
      );
    });

    it('el código anterior (sin dueño) sigue guardando: queda del equipo y su autor es el dueño', async () => {
      // Lo que hace la imagen anterior si se vuelve atrás sin revertir la migración.
      const name = `Vieja IT ${Date.now()}`;
      const [row]: Array<{ scope: string; owner_user_id: string }> =
        await ds.query(
          `INSERT INTO growth.import_mapping_templates (target, name, column_mapping, created_by_user_id)
         VALUES ('ORGANIZATIONS', $1, '[{"header":"x","field":"legalName"}]', $2)
         RETURNING scope, owner_user_id`,
          [name, LIMITED],
        );
      expect(row).toEqual({ scope: 'TEAM', owner_user_id: LIMITED });
      // El código nuevo, que siempre manda el dueño, no lo toca.
      const [own]: Array<{ scope: string; owner_user_id: string }> =
        await ds.query(
          `INSERT INTO growth.import_mapping_templates (target, name, column_mapping, scope, owner_user_id, created_by_user_id)
         VALUES ('ORGANIZATIONS', $1, '[{"header":"x","field":"legalName"}]', 'PERSONAL', $2, $2)
         RETURNING scope, owner_user_id`,
          [`${name} propia`, MANAGER],
        );
      expect(own).toEqual({ scope: 'PERSONAL', owner_user_id: MANAGER });
    });

    it('guardar el mapeo de un lote crea una personal y no pisa la de nadie', async () => {
      const shared = await templates.create(
        {
          target: T.ORGANIZATIONS,
          name: 'Equipo IT',
          scope: Scope.TEAM,
          columnMapping: mapping,
        },
        admin,
      );
      const b = await upload(
        `Razón social;NIT\nAndes ${Date.now()};${nitOf(9100)}-${dv(nitOf(9100))}`,
        T.ORGANIZATIONS,
        manager,
      );
      const preview = await imports.preview(b.id, manager);
      // Mismo nombre que una del equipo: queda como personal aparte.
      await imports.map(
        {
          batchId: b.id,
          mapping: preview.suggestedMapping,
          saveAsTemplate: 'Equipo IT',
        },
        manager,
      );
      const visible = await templates.list(T.ORGANIZATIONS, manager);
      const both = visible.filter((t) => t.name === 'Equipo IT');
      expect(both.map((t) => t.scope).sort()).toEqual([
        Scope.PERSONAL,
        Scope.TEAM,
      ]);
      const team = both.find((t) => t.scope === Scope.TEAM)!;
      expect(team.id).toBe(shared.id);
      expect(team.columnMapping).toEqual(mapping);
      // Repetir el nombre propio al mapear es un error y no cambia nada.
      await expect(
        imports.map(
          {
            batchId: b.id,
            mapping: preview.suggestedMapping,
            saveAsTemplate: 'Equipo IT',
          },
          manager,
        ),
      ).rejects.toThrow(/Ya tienes una plantilla/);
      queued.length = 0;
    });

    it('las del equipo: todos las usan; solo la gestión las crea, comparte, edita o archiva', async () => {
      await expect(
        templates.create(
          {
            target: T.ORGANIZATIONS,
            name: 'Sin permiso IT',
            scope: Scope.TEAM,
            columnMapping: mapping,
          },
          limited,
        ),
      ).rejects.toThrow(/permiso de gestión/);
      const team = await templates.create(
        {
          target: T.ORGANIZATIONS,
          name: 'Del equipo IT',
          scope: Scope.TEAM,
          columnMapping: mapping,
        },
        manager,
      );
      expect((await names())[0]).toContain('Del equipo IT');
      expect(templates.canEdit(team, limited)).toBe(false);
      await expect(
        templates.update({ id: team.id, name: 'Cambio' }, limited),
      ).rejects.toThrow(/permiso de gestión/);
      await expect(
        templates.archive(team.id, 'Ya no sirve', limited),
      ).rejects.toThrow(/permiso de gestión/);

      // Compartir: una personal propia pasa al equipo si el nombre está libre allí.
      const draft = await templates.create(
        {
          target: T.ORGANIZATIONS,
          name: 'Para compartir IT',
          columnMapping: mapping,
        },
        manager,
      );
      await expect(templates.share(draft.id, limited)).rejects.toThrow(
        /permiso de gestión/,
      );
      const shared = await templates.share(draft.id, manager);
      expect(shared.scope).toBe(Scope.TEAM);
      expect((await names())[0]).toContain('Para compartir IT');
      const clash = await templates.create(
        {
          target: T.ORGANIZATIONS,
          name: 'Del equipo IT',
          columnMapping: mapping,
        },
        manager,
      );
      await expect(templates.share(clash.id, manager)).rejects.toThrow(
        /Ya hay una plantilla del equipo/,
      );

      // Archivar: deja de listarse, no se borra y no se puede editar.
      const archived = await templates.archive(
        team.id,
        'Reemplazada por otra',
        manager,
      );
      expect(archived.archivedAt).toBeTruthy();
      expect((await names())[0]).not.toContain('Del equipo IT');
      const [row] = await ds.query(
        `SELECT archived_by_user_id FROM growth.import_mapping_templates WHERE id = $1`,
        [team.id],
      );
      expect(row.archived_by_user_id).toBe(MANAGER);
      await expect(
        templates.update({ id: team.id, name: 'Otra vez' }, manager),
      ).rejects.toThrow(/no encontrada/);
      // Con la archivada fuera, el nombre vuelve a estar libre en el equipo.
      await templates.create(
        {
          target: T.ORGANIZATIONS,
          name: 'Del equipo IT',
          scope: Scope.TEAM,
          columnMapping: mapping,
        },
        manager,
      );
    });

    it('no guarda datos: rechaza correos o teléfonos como encabezado y la actividad no lleva encabezados', async () => {
      await expect(
        templates.create(
          {
            target: T.ORGANIZATIONS,
            name: 'Con datos IT',
            columnMapping: [{ header: 'ana@andes.co', field: F.EMAIL }],
          },
          limited,
        ),
      ).rejects.toThrow(/no puede ser un correo ni un teléfono/);
      const t = await templates.create(
        {
          target: T.ORGANIZATIONS,
          name: 'Limpia IT',
          columnMapping: [
            { header: 'Columna secreta Andes', field: F.LEGAL_NAME },
          ],
        },
        limited,
      );
      const events: ActivityEvent[] = await ds
        .getRepository(ActivityEvent)
        .findBy({ entityId: t.id });
      expect(events.map((e) => e.action)).toEqual(['IMPORT_TEMPLATE_CREATED']);
      expect(JSON.stringify(events[0].changes)).not.toMatch(
        /secreta|Andes|Limpia/,
      );
    });
  });

  describe('reglas del flujo', () => {
    it('fuente no ACTIVE o fecha futura: no se sube', async () => {
      await ds.query(
        `UPDATE growth.data_sources SET status = 'DISABLED' WHERE id = $1`,
        [sourceId],
      );
      await expect(upload('Razón social\nAndes')).rejects.toThrow(/fuente/i);
      await ds.query(
        `UPDATE growth.data_sources SET status = 'ACTIVE' WHERE id = $1`,
        [sourceId],
      );
      await expect(
        imports.upload(
          { buffer: Buffer.from('Razón social\nAndes'), originalname: 'x.csv' },
          {
            target: T.ORGANIZATIONS,
            sourceId,
            consultedAt: new Date(Date.now() + 86_400_000),
          },
          admin,
        ),
      ).rejects.toThrow(/futura/);
    });

    it('archivo inválido: binario o sin filas', async () => {
      await expect(
        upload(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 1])),
      ).rejects.toThrow(/CSV ni XLSX/);
      await expect(upload('Razón social\n')).rejects.toThrow(/filas/);
    });

    it('un mapeo nuevo invalida la validación anterior y un trabajo viejo no escribe', async () => {
      const b = await upload('Razón social;NIT\nAndes;\nBeta;');
      await imports.map(
        { batchId: b.id, mapping: [{ column: 0, field: F.LEGAL_NAME }] },
        admin,
      );
      const stale = queued.shift()!;
      await imports.map(
        {
          batchId: b.id,
          mapping: [
            { column: 0, field: F.LEGAL_NAME },
            { column: 1, field: F.NIT },
          ],
        },
        admin,
      );
      await processor.process({ name: stale.name, data: stale.data } as never); // mapeo viejo: no hace nada
      expect((await imports.get(b.id, admin)).status).toBe(S.MAPPED);
      await drain();
      expect((await imports.get(b.id, admin)).status).toBe(S.VALIDATED);
      // Volver a mapear desde VALIDATED reinicia las decisiones.
      await imports.map(
        { batchId: b.id, mapping: [{ column: 0, field: F.LEGAL_NAME }] },
        admin,
      );
      expect((await rowsOf(b.id)).every((r) => r.decision === null)).toBe(true);
      queued.length = 0;
    });

    it('cancelar durante la validación: el trabajo no sobrescribe', async () => {
      const b = await upload('Razón social\nAndes');
      await imports.map(
        { batchId: b.id, mapping: [{ column: 0, field: F.LEGAL_NAME }] },
        admin,
      );
      await ds.query(
        `UPDATE growth.import_batches SET status = 'VALIDATING' WHERE id = $1`,
        [b.id],
      );
      await imports.cancel(b.id, 'Ya no se necesita', admin);
      await drain();
      const after = await imports.get(b.id, admin);
      expect(after.status).toBe(S.CANCELLED);
      expect((await rowsOf(b.id))[0].decision).toBeNull();
      await expect(imports.commit(b.id, admin)).rejects.toThrow(/CANCELLED/);
    });

    it('agotados los reintentos queda FAILED', async () => {
      const b = await upload('Razón social\nAndes');
      await imports.map(
        { batchId: b.id, mapping: [{ column: 0, field: F.LEGAL_NAME }] },
        admin,
      );
      queued.length = 0;
      await processor.onFailed(
        {
          name: 'validate',
          data: { batchId: b.id, actor: admin },
          attemptsMade: 3,
          opts: { attempts: 3 },
        } as never,
        new Error('Redis caído'),
      );
      const after = await imports.get(b.id, admin);
      expect(after.status).toBe(S.FAILED);
      expect(after.finishedAt).toBeTruthy();
    });

    it('personas: exige declarar la clase del canal; nacen con base jurídica pendiente', async () => {
      const b = await upload(
        'Nombre completo;Correo;Independiente\nAna Ruiz;ana@ruizph.co;sí\nLuis Gil;;no',
        T.PEOPLE,
      );
      const mapping = [
        { column: 0, field: F.FULL_NAME },
        { column: 1, field: F.EMAIL },
        { column: 2, field: F.IS_INDEPENDENT_ADMIN },
      ];
      await expect(
        imports.map({ batchId: b.id, mapping }, admin),
      ).rejects.toThrow(/PROFESSIONAL o DIRECT/);
      await imports.map(
        {
          batchId: b.id,
          mapping,
          personChannelClass: GrowthChannelClass.PROFESSIONAL,
        },
        admin,
      );
      await drain();
      await imports.commit(b.id, admin);
      await drain();
      const [ana] = await rowsOf(b.id);
      const person = await ds
        .getRepository(Person)
        .findOneByOrFail({ id: ana.resultEntityId! });
      expect(person.legalBasis).toBe('PENDING_LEGAL_REVIEW');
      expect(person.contactStatus).toBe('NOT_AUTHORIZED');
      expect(person.isIndependentAdmin).toBe(true);
      const [channel] = await ds
        .getRepository(PersonChannel)
        .findBy({ personId: person.id });
      expect(channel.channelClass).toBe(GrowthChannelClass.PROFESSIONAL);
    });

    it('XLSX de copropiedades: matrícula repetida en la base sugiere vincular', async () => {
      const ExcelJS = await import('exceljs');
      const existing = await new PropertiesService(
        ds,
        new ProspectGuardsService(
          ds,
          new ActivityLogService(ds.getRepository(ActivityEvent)),
        ),
        new EvidencesService(
          ds,
          new ProspectGuardsService(
            ds,
            new ActivityLogService(ds.getRepository(ActivityEvent)),
          ),
          new ActivityLogService(ds.getRepository(ActivityEvent)),
        ),
        new ActivityLogService(ds.getRepository(ActivityEvent)),
      ).create(
        {
          name: 'Conjunto Mirador IT',
          realEstateRegistration: '50C-998877',
          source: {
            sourceId,
            consultedAt: new Date(),
            reliability: GrowthEvidenceReliability.HIGH,
          },
        },
        admin,
      );
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Copropiedades');
      ws.addRow(['Nombre', 'Matrícula', 'Unidades', 'Localidad']);
      ws.addRow(['Mirador', '50c 998877', 240, 'Usaquén']);
      ws.addRow([
        'Nuevo Horizonte',
        '50N-1',
        { formula: '100+20', result: 120 },
        'Kennedy',
      ]);
      const b = await upload(
        Buffer.from(await wb.xlsx.writeBuffer()),
        T.PROPERTIES,
        admin,
        'copropiedades.xlsx',
      );
      expect(b.fileKind).toBe('XLSX');
      const { suggestedMapping } = await imports.preview(b.id, admin);
      await imports.map({ batchId: b.id, mapping: suggestedMapping }, admin);
      await drain();
      const [mirador, nuevo] = await rowsOf(b.id);
      expect(mirador.decision).toBe(D.LINK_EXISTING);
      expect(mirador.linkEntityId).toBe(existing.id);
      expect(nuevo.decision).toBe(D.CREATE);
      expect(nuevo.mapped).toMatchObject({
        estimatedUnits: 120,
        locality: 'KENNEDY',
      });
    });
  });

  describe('visibilidad y datos personales', () => {
    it('sin VIEW_ALL no se ven lotes ajenos; sin VIEW_GROWTH_CONTACT_DATA los contactos salen enmascarados', async () => {
      const mine = await upload(
        'Nombre completo;Teléfono\nAna;3001234567',
        T.PEOPLE,
        limited,
      );
      const other = await upload('Razón social\nAjena', T.ORGANIZATIONS, admin);
      await expect(imports.get(other.id, limited)).rejects.toThrow(
        /no encontrado/,
      );
      const list = await imports.list(limited);
      expect(list.items.map((b) => b.id)).toEqual([mine.id]);
      expect((await imports.preview(mine.id, limited)).rows[0]).toEqual([
        'Ana',
        '*** *** **67',
      ]);
      expect((await imports.preview(mine.id, admin)).rows[0]).toEqual([
        'Ana',
        '3001234567',
      ]);
    });
  });

  describe('purga a 30 días (ajuste D)', () => {
    const finishedAgo = async (days: number) => {
      const b = await upload('Razón social;Correo\nAndes;ana@andes.co');
      await imports.cancel(b.id, 'Prueba de purga', admin);
      await ds.query(
        `UPDATE growth.import_batches SET finished_at = now() - make_interval(days => $2) WHERE id = $1`,
        [b.id, days],
      );
      return b;
    };

    it('borra las filas crudas; conserva el lote; el evento no lleva datos', async () => {
      const old = await finishedAgo(31);
      const recent = await finishedAgo(29);
      const held = await finishedAgo(40);
      await ds.query(
        `INSERT INTO growth.legal_holds (entity_type, entity_id, legal_basis, hold_until, created_by_user_id)
         VALUES ('IMPORT_BATCH', $1, 'Requerimiento de autoridad', now() + interval '1 year', $2)`,
        [held.id, ADMIN],
      );

      expect(await purge.purgeDue()).toBe(1);

      const [row] = await rowsOf(old.id);
      expect(row.raw).toBeNull();
      expect(row.mapped).toBeNull();
      expect((await imports.get(old.id, admin)).purgedAt).toBeTruthy();
      expect((await rowsOf(recent.id))[0].raw).not.toBeNull();
      expect((await rowsOf(held.id))[0].raw).not.toBeNull();

      const [event] = await ds
        .getRepository(ActivityEvent)
        .findBy({ entityId: old.id, action: 'IMPORT_PURGED' });
      expect(event.actorUserId).toBeNull();
      expect(JSON.stringify(event.changes)).not.toMatch(/andes|Andes/);
      expect(event.changes).toMatchObject({ rowsCleared: 1 });

      // Un lote purgado ya no cambia, ni da informe.
      await expectDbError(
        ds.query(
          `UPDATE growth.import_batches SET status_reason = 'x' WHERE id = $1`,
          [old.id],
        ),
        /purgado/,
      );
      await expect(imports.report(old.id, admin)).rejects.toThrow(/purgó/);
      // Correr de nuevo no repite.
      expect(await purge.purgeDue()).toBe(0);
    });
  });

  describe('ajustes de la revisión de 1C', () => {
    const SUP = 'no.contactar@sondeo-ph.co';
    const SUP_PHONE = '3159998877';

    it('un dato excluido no queda en ninguna tabla ni en el informe, aunque venga en una columna sin mapear', async () => {
      await suppressions.add(
        {
          identifierType: GrowthIdentifierType.EMAIL,
          value: SUP,
          scope: GrowthSuppressionScope.ALL_CHANNELS,
          reason: GrowthSuppressionReason.UNSUBSCRIBE,
        },
        admin,
      );
      await suppressions.add(
        {
          identifierType: GrowthIdentifierType.PHONE,
          value: SUP_PHONE,
          scope: GrowthSuppressionScope.ALL_CHANNELS,
          reason: GrowthSuppressionReason.UNSUBSCRIBE,
        },
        admin,
      );
      const b = await upload(
        `Razón social;Correo;Teléfono;Notas\nSondeo SAS;${SUP.toUpperCase()};315 999 8877;llamar a ${SUP} o al +57 315 999 8877`,
      );
      expect(b.suppressedValues).toBe(4);
      await imports.map(
        {
          batchId: b.id,
          mapping: [
            { column: 0, field: F.LEGAL_NAME },
            { column: 1, field: F.EMAIL },
            { column: 2, field: F.PHONE },
          ],
        },
        admin,
      );
      await drain();
      const [row] = await rowsOf(b.id);
      expect(row.warnings).toEqual(
        expect.arrayContaining([
          { field: 'email', code: 'SUPPRESSED' },
          { field: 'phone', code: 'SUPPRESSED' },
        ]),
      );
      expect(row.raw).toEqual([
        'Sondeo SAS',
        '[excluido]',
        '[excluido]',
        'llamar a [excluido] o al [excluido]',
      ]);
      await imports.commit(b.id, admin);
      await drain();

      // Búsqueda en todo el esquema growth (texto) por el correo y el teléfono.
      const tables: Array<{ table_name: string; column_name: string }> =
        await ds.query(
          `SELECT table_name, column_name FROM information_schema.columns
            WHERE table_schema = 'growth' AND data_type IN ('text', 'character varying', 'jsonb', 'ARRAY')`,
        );
      for (const needle of [
        SUP,
        'no.contactar',
        '3159998877',
        '315 999 8877',
      ]) {
        for (const { table_name, column_name } of tables) {
          const [{ n }] = await ds.query(
            `SELECT count(*)::int AS n FROM growth."${table_name}" WHERE "${column_name}"::text ILIKE $1`,
            [`%${needle}%`],
          );
          expect({ table_name, column_name, needle, n }).toMatchObject({
            n: 0,
          });
        }
      }
      // Ni en el informe, ni siquiera para quien ve datos de contacto.
      const { content } = await imports.report(b.id, admin);
      const ExcelJS = await import('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(content as unknown as ArrayBuffer);
      const txt = JSON.stringify(wb.getWorksheet('Filas')!.getSheetValues());
      expect(txt).not.toMatch(/no\.contactar|3159998877|315 999 8877/i);
    });

    it('una exclusión agregada después de subir se redacta al validar', async () => {
      const late = 'tarde@sondeo-ph.co';
      const b = await upload(`Razón social;Correo\nTarde SAS;${late}`);
      await suppressions.add(
        {
          identifierType: GrowthIdentifierType.EMAIL,
          value: late,
          scope: GrowthSuppressionScope.ALL_CHANNELS,
          reason: GrowthSuppressionReason.UNSUBSCRIBE,
        },
        admin,
      );
      await imports.map(
        {
          batchId: b.id,
          mapping: [
            { column: 0, field: F.LEGAL_NAME },
            { column: 1, field: F.EMAIL },
          ],
        },
        admin,
      );
      await drain();
      const [row] = await rowsOf(b.id);
      expect(row.raw).toEqual(['Tarde SAS', '[excluido]']);
      expect((await imports.get(b.id, admin)).suppressedValues).toBe(1);
    });

    it('dos confirmaciones simultáneas del mismo lote no duplican (lock por lote)', async () => {
      const b = await upload('Razón social\nAlfa L\nBeta L\nGama L\nDelta L');
      await imports.map(
        { batchId: b.id, mapping: [{ column: 0, field: F.LEGAL_NAME }] },
        admin,
      );
      await drain();
      await imports.commit(b.id, admin);
      queued.length = 0;
      const before = await ds.getRepository(Organization).count();
      const job = {
        name: 'commit',
        data: { batchId: b.id, actor: admin },
      } as never;
      await Promise.all([processor.process(job), processor.process(job)]);
      expect((await ds.getRepository(Organization).count()) - before).toBe(4);
      expect((await imports.get(b.id, admin)).status).toBe(S.COMMITTED);
    });

    it('reanuda: las filas que ya tienen resultado no se reprocesan', async () => {
      const b = await upload('Razón social\nUno R\nDos R\nTres R');
      await imports.map(
        { batchId: b.id, mapping: [{ column: 0, field: F.LEGAL_NAME }] },
        admin,
      );
      await drain();
      await imports.commit(b.id, admin);
      const [first] = await rowsOf(b.id);
      await ds.query(
        `UPDATE growth.import_rows SET result = 'SKIPPED', processed_at = now() WHERE id = $1`,
        [first.id],
      );
      const before = await ds.getRepository(Organization).count();
      await drain();
      expect((await ds.getRepository(Organization).count()) - before).toBe(2);
      expect((await rowsOf(b.id)).map((r) => r.result)).toEqual([
        R.SKIPPED,
        R.CREATED,
        R.CREATED,
      ]);
    });

    it('un XLSX con texto repetido masivamente se rechaza antes de guardar', async () => {
      const ExcelJS = await import('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('a');
      const big = 'x'.repeat(2000);
      ws.addRow(Array.from({ length: 100 }, (_, i) => `c${i}`));
      for (let i = 0; i < 100; i++)
        ws.addRow(Array.from({ length: 100 }, () => big));
      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      expect(buf.length).toBeLessThan(200_000);
      const count = await ds.getRepository(ImportBatch).count();
      await expect(
        upload(buf, T.ORGANIZATIONS, admin, 'amplificado.xlsx'),
      ).rejects.toThrow(/demasiado texto/);
      expect(await ds.getRepository(ImportBatch).count()).toBe(count);
    });

    it('lotes abandonados: a los 7 días se cierran y luego se purgan; uno confirmando queda FAILED', async () => {
      const mk = (label: string) => upload(`Razón social\n${label}`);
      const uploaded = await mk('Abandonado subido');
      const validated = await mk('Abandonado validado');
      await imports.map(
        {
          batchId: validated.id,
          mapping: [{ column: 0, field: F.LEGAL_NAME }],
        },
        admin,
      );
      await drain();
      const committing = await mk('Abandonado confirmando');
      await imports.map(
        {
          batchId: committing.id,
          mapping: [{ column: 0, field: F.LEGAL_NAME }],
        },
        admin,
      );
      await drain();
      await imports.commit(committing.id, admin);
      queued.length = 0; // la confirmación nunca corre
      const fresh = await mk('Reciente');
      for (const b of [uploaded, validated, committing]) {
        await ds.query(
          `UPDATE growth.import_batches SET updated_at = now() - interval '8 days' WHERE id = $1`,
          [b.id],
        );
      }

      expect(await purge.expireInactive()).toBe(3);
      expect((await imports.get(uploaded.id, admin)).status).toBe(S.CANCELLED);
      expect((await imports.get(validated.id, admin)).status).toBe(S.CANCELLED);
      expect((await imports.get(committing.id, admin)).status).toBe(S.FAILED);
      expect((await imports.get(fresh.id, admin)).status).toBe(S.UPLOADED);
      const [ev] = await ds
        .getRepository(ActivityEvent)
        .findBy({ entityId: uploaded.id, action: 'IMPORT_EXPIRED' });
      expect(ev.actorUserId).toBeNull();

      // 30 días después de cerrarse, se purgan.
      const in31 = new Date(Date.now() + 31 * 86_400_000);
      await purge.purgeDue(in31);
      for (const b of [uploaded, validated, committing]) {
        expect((await imports.get(b.id, admin)).purgedAt).toBeTruthy();
        expect((await rowsOf(b.id))[0].raw).toBeNull();
      }
      await imports.cancel(fresh.id, 'Fin de la prueba', admin);
    });

    it('purga por estado: COMMITTED, FAILED y CANCELLED; retención liberada o vencida no la impide, activa sí', async () => {
      const mk = (label: string) => upload(`Razón social\n${label}`);
      const committed = await mk('Purga confirmado');
      await imports.map(
        {
          batchId: committed.id,
          mapping: [{ column: 0, field: F.LEGAL_NAME }],
        },
        admin,
      );
      await drain();
      await imports.commit(committed.id, admin);
      await drain();
      const failed = await mk('Purga fallido');
      await imports.map(
        { batchId: failed.id, mapping: [{ column: 0, field: F.LEGAL_NAME }] },
        admin,
      );
      queued.length = 0;
      await imports.markFailed(failed.id, 'prueba');
      const cancelled = await mk('Purga cancelado');
      await imports.cancel(cancelled.id, 'Prueba de purga', admin);
      const released = await mk('Retención liberada');
      await imports.cancel(released.id, 'Prueba de purga', admin);
      const expired = await mk('Retención vencida');
      await imports.cancel(expired.id, 'Prueba de purga', admin);
      const active = await mk('Retención activa');
      await imports.cancel(active.id, 'Prueba de purga', admin);
      const holdBasis = 'Requerimiento de autoridad (prueba)';
      await ds.query(
        `INSERT INTO growth.legal_holds (entity_type, entity_id, legal_basis, hold_until, created_by_user_id, released_at, released_by_user_id, release_reason)
         VALUES ('IMPORT_BATCH', $1, $3, now() + interval '1 year', $2, now(), $2, 'Liberada por la autoridad')`,
        [released.id, ADMIN, holdBasis],
      );
      await ds.query(
        `INSERT INTO growth.legal_holds (entity_type, entity_id, legal_basis, hold_until, created_by_user_id, created_at)
         VALUES ('IMPORT_BATCH', $1, $3, current_date - 1, $2, now() - interval '1 year')`,
        [expired.id, ADMIN, holdBasis],
      );
      await ds.query(
        `INSERT INTO growth.legal_holds (entity_type, entity_id, legal_basis, hold_until, created_by_user_id)
         VALUES ('IMPORT_BATCH', $1, $3, now() + interval '1 year', $2)`,
        [active.id, ADMIN, holdBasis],
      );
      const in31 = new Date(Date.now() + 31 * 86_400_000);
      await purge.purgeDue(in31);
      for (const b of [committed, failed, cancelled, released, expired]) {
        expect((await imports.get(b.id, admin)).purgedAt).toBeTruthy();
      }
      expect((await imports.get(active.id, admin)).purgedAt).toBeNull();
      expect((await rowsOf(active.id))[0].raw).not.toBeNull();
    });
  });
});

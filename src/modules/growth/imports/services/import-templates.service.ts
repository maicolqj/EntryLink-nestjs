import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../../shared/utils/errors.utils';
import { ActivityLogService } from '../../activity/services/activity-log.service';
import { GrowthErrorCode } from '../../shared/growth-error-codes';
import { GrowthEntityType } from '../../shared/growth.enums';
import {
  GrowthCreateImportTemplateInput,
  GrowthUpdateImportTemplateInput,
} from '../dto/inputs/import.inputs';
import { ImportMappingTemplate } from '../entities/import.entities';
import {
  GrowthImportField as F,
  GrowthImportTarget as T,
  GrowthImportTemplateScope as Scope,
} from '../imports.enums';
import {
  canEditTemplate,
  canManageTeamTemplates,
  canReadTemplate,
  looksLikeContactValue,
  normalizeTemplateName,
  templateMappingProblems,
  templateNameProblem,
} from '../shared/templates';
import { ImportRedactionService } from './import-redaction.service';

type HeaderMapping = Array<{ header: string; field: F }>;

/**
 * Plantillas de mapeo personales y del equipo.
 *
 * - PERSONAL: solo su dueño la ve, la edita y la archiva.
 * - TEAM: la usa todo quien importa; solo MANAGE_GROWTH_IMPORT_TEMPLATES la
 *   crea, la comparte (desde una personal propia), la edita o la archiva.
 * - Nunca se sobrescribe por nombre: un nombre tomado en el mismo alcance es
 *   un error (también lo impide un índice único en la base).
 * - Solo encabezados y campos; los encabezados pasan por la lista de
 *   exclusión y un encabezado que es un correo o teléfono se rechaza.
 * - Se archiva, no se borra. Cada operación queda en la actividad, sin
 *   encabezados ni valores.
 *
 * Lo que el actor no puede ver responde NOT_FOUND, sin revelar que existe.
 */
@Injectable()
export class ImportTemplatesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly activity: ActivityLogService,
    private readonly redaction: ImportRedactionService,
  ) {}

  /** Las del equipo y las personales del actor, vigentes. */
  list(target: T, actor: JwtAccessPayload): Promise<ImportMappingTemplate[]> {
    return this.dataSource.manager
      .createQueryBuilder(ImportMappingTemplate, 't')
      .where('t.target = :target', { target })
      .andWhere('t.archivedAt IS NULL')
      .andWhere(
        `(t.scope = :team OR (t.scope = :personal AND t.ownerUserId = :me))`,
        { team: Scope.TEAM, personal: Scope.PERSONAL, me: actor.sub },
      )
      .orderBy('t.scope', 'DESC') // TEAM antes que PERSONAL
      .addOrderBy('t.name', 'ASC')
      .take(200)
      .getMany();
  }

  async create(
    input: GrowthCreateImportTemplateInput,
    actor: JwtAccessPayload,
  ): Promise<ImportMappingTemplate> {
    const scope = input.scope ?? Scope.PERSONAL;
    if (scope === Scope.TEAM && !canManageTeamTemplates(actor)) {
      throw forbidden('Crear plantillas del equipo exige permiso de gestión');
    }
    const name = this.checkName(input.name);
    const mapping = await this.checkMapping(input.target, input.columnMapping);
    return this.dataSource.transaction((manager) =>
      this.insert(manager, {
        target: input.target,
        name,
        scope,
        mapping,
        actor,
      }),
    );
  }

  /**
   * Guardar el mapeo de un lote como plantilla PERSONAL (lo usa
   * `growthMapImportColumns` con `saveAsTemplate`). Los encabezados del lote
   * ya llegaron redactados al subir.
   */
  async saveFromBatch(
    manager: EntityManager,
    data: { target: T; name: string; mapping: HeaderMapping },
    actor: JwtAccessPayload,
  ): Promise<ImportMappingTemplate> {
    const name = this.checkName(data.name);
    // Columnas sin encabezado, o cuyo «encabezado» es un dato (archivo sin
    // fila de encabezados), no se pueden reconocer después: no se guardan.
    const mapping = data.mapping
      .map((m) => ({ header: (m.header ?? '').trim(), field: m.field }))
      .filter((m) => m.header && !looksLikeContactValue(m.header));
    if (!mapping.length) {
      throw invalid(
        'No se puede guardar como plantilla: las columnas mapeadas no tienen encabezado',
      );
    }
    const problems = templateMappingProblems(data.target, mapping);
    if (problems.length) throw invalid(problems.join('. '));
    return this.insert(manager, {
      target: data.target,
      name,
      scope: Scope.PERSONAL,
      mapping,
      actor,
    });
  }

  async update(
    input: GrowthUpdateImportTemplateInput,
    actor: JwtAccessPayload,
  ): Promise<ImportMappingTemplate> {
    const name =
      input.name !== undefined ? this.checkName(input.name) : undefined;
    return this.dataSource.transaction(async (manager) => {
      const t = await this.findEditable(manager, input.id, actor);
      const mapping = input.columnMapping
        ? await this.checkMapping(t.target, input.columnMapping)
        : undefined;
      const changes: Record<string, unknown> = { scope: t.scope };
      if (name !== undefined && name !== t.name) {
        await this.assertNameFree(manager, t.target, t.scope, name, t);
        changes.renamed = true;
        t.name = name;
      }
      if (mapping) {
        t.columnMapping = mapping;
        changes.columns = mapping.length;
      }
      t.updatedByUserId = actor.sub;
      const saved = await this.save(manager, t);
      await this.record(
        manager,
        actor,
        'IMPORT_TEMPLATE_UPDATED',
        saved,
        changes,
      );
      return saved;
    });
  }

  /** Una personal propia pasa al equipo; el nombre debe estar libre allí. */
  async share(
    id: string,
    actor: JwtAccessPayload,
  ): Promise<ImportMappingTemplate> {
    if (!canManageTeamTemplates(actor)) {
      throw forbidden('Compartir plantillas exige permiso de gestión');
    }
    return this.dataSource.transaction(async (manager) => {
      const t = await this.findEditable(manager, id, actor);
      if (t.scope === Scope.TEAM)
        throw invalid('La plantilla ya es del equipo');
      await this.assertNameFree(manager, t.target, Scope.TEAM, t.name, t);
      t.scope = Scope.TEAM;
      t.updatedByUserId = actor.sub;
      const saved = await this.save(manager, t);
      await this.record(manager, actor, 'IMPORT_TEMPLATE_SHARED', saved, {});
      return saved;
    });
  }

  async archive(
    id: string,
    reason: string,
    actor: JwtAccessPayload,
  ): Promise<ImportMappingTemplate> {
    const why = (reason ?? '').trim();
    if (why.length < 5 || why.length > 500) {
      throw invalid('El motivo debe tener entre 5 y 500 caracteres');
    }
    return this.dataSource.transaction(async (manager) => {
      const t = await this.findEditable(manager, id, actor);
      t.archivedAt = new Date();
      t.archivedByUserId = actor.sub;
      const saved = await manager.save(t);
      // El motivo puede nombrar personas: no va a la actividad.
      await this.record(manager, actor, 'IMPORT_TEMPLATE_ARCHIVED', saved, {});
      return saved;
    });
  }

  canEdit(t: ImportMappingTemplate, actor: JwtAccessPayload): boolean {
    return canEditTemplate(t, actor);
  }

  // ── Internos ───────────────────────────────────────────────────────────────

  private checkName(name: string): string {
    const problem = templateNameProblem(name);
    if (problem) throw invalid(problem);
    return normalizeTemplateName(name);
  }

  /** Valida y pasa los encabezados por la lista de exclusión. */
  private async checkMapping(
    target: T,
    mapping: HeaderMapping,
  ): Promise<HeaderMapping> {
    const clean = mapping.map((m) => ({
      header: (m.header ?? '').trim(),
      field: m.field,
    }));
    const problems = templateMappingProblems(target, clean);
    if (problems.length) throw invalid(problems.join('. '));
    const headers = [clean.map((m) => m.header)];
    await this.redaction.redact(headers);
    return clean.map((m, i) => ({ header: headers[0][i], field: m.field }));
  }

  private async insert(
    manager: EntityManager,
    data: {
      target: T;
      name: string;
      scope: Scope;
      mapping: HeaderMapping;
      actor: JwtAccessPayload;
    },
  ): Promise<ImportMappingTemplate> {
    await this.assertNameFree(
      manager,
      data.target,
      data.scope,
      data.name,
      null,
      data.actor.sub,
    );
    const saved = await this.save(
      manager,
      manager.create(ImportMappingTemplate, {
        target: data.target,
        name: data.name,
        scope: data.scope,
        columnMapping: data.mapping,
        ownerUserId: data.actor.sub,
        createdByUserId: data.actor.sub,
        updatedByUserId: data.actor.sub,
      }),
    );
    await this.record(manager, data.actor, 'IMPORT_TEMPLATE_CREATED', saved, {
      columns: data.mapping.length,
    });
    return saved;
  }

  /** Lo que el actor no puede ver o no puede editar. */
  private async findEditable(
    manager: EntityManager,
    id: string,
    actor: JwtAccessPayload,
  ): Promise<ImportMappingTemplate> {
    const t = await manager.findOne(ImportMappingTemplate, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!t || !canReadTemplate(t, actor) || t.archivedAt) {
      throw new CustomError({
        message: 'Plantilla no encontrada',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: GrowthErrorCode.GROWTH_NOT_FOUND,
      });
    }
    if (!canEditTemplate(t, actor)) {
      throw forbidden(
        'Solo quien tenga permiso de gestión cambia las plantillas del equipo',
      );
    }
    return t;
  }

  private async assertNameFree(
    manager: EntityManager,
    target: T,
    scope: Scope,
    name: string,
    self: ImportMappingTemplate | null,
    ownerUserId: string = self?.ownerUserId ?? '',
  ): Promise<void> {
    const [taken]: Array<{ id: string }> = await manager.query(
      `SELECT id FROM growth.import_mapping_templates
        WHERE target = $1 AND lower(name) = lower($2) AND scope = $3 AND archived_at IS NULL
          AND ($3 = 'TEAM' OR owner_user_id = $4) AND id <> $5
        LIMIT 1`,
      [
        target,
        name,
        scope,
        ownerUserId,
        self?.id ?? '00000000-0000-0000-0000-000000000000',
      ],
    );
    if (taken) throw nameTaken(scope);
  }

  /** Si otra transacción ganó la carrera, el índice único responde. */
  private async save(
    manager: EntityManager,
    t: ImportMappingTemplate,
  ): Promise<ImportMappingTemplate> {
    try {
      return await manager.save(t);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        /uq_growth_import_tpl_(team|personal)/.test(String(error.message))
      ) {
        throw nameTaken(t.scope);
      }
      throw error;
    }
  }

  private record(
    manager: EntityManager,
    actor: JwtAccessPayload,
    action: string,
    t: ImportMappingTemplate,
    changes: Record<string, unknown>,
  ): Promise<unknown> {
    return this.activity.record(manager, actor, {
      action,
      entityType: GrowthEntityType.IMPORT_TEMPLATE,
      entityId: t.id,
      changes: { target: t.target, scope: t.scope, ...changes },
    });
  }
}

function invalid(message: string): CustomError {
  return new CustomError({
    message,
    statusCode: HttpStatus.BAD_REQUEST,
    errorCode: GrowthErrorCode.GROWTH_INVALID_INPUT,
  });
}

function forbidden(message: string): CustomError {
  return new CustomError({
    message,
    statusCode: HttpStatus.FORBIDDEN,
    errorCode: GrowthErrorCode.GROWTH_IMPORT_TEMPLATE_FORBIDDEN,
  });
}

function nameTaken(scope: Scope): CustomError {
  return new CustomError({
    message:
      scope === Scope.TEAM
        ? 'Ya hay una plantilla del equipo con ese nombre'
        : 'Ya tienes una plantilla con ese nombre',
    statusCode: HttpStatus.CONFLICT,
    errorCode: GrowthErrorCode.GROWTH_IMPORT_TEMPLATE_NAME_TAKEN,
  });
}

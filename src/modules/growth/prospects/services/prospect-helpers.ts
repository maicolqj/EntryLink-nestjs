import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { GrowthProspectKind, GrowthValidationStatus } from '../prospects.enums';
import { GrowthProspectFilterInput } from '../dto/inputs/prospect.inputs';
import { ValidatableRecord } from '../entities/validatable-record';
import { stripAccents } from '../shared/prospect-normalizers';
import {
  PROSPECT_TARGETS,
  ProspectGuardsService,
} from './prospect-guards.service';

/**
 * Si cambia un campo crítico de un registro VALIDATED, vuelve a
 * PENDING_REVIEW (transición permitida por el trigger). Devuelve true si
 * hubo que revalidar.
 */
export function requireRevalidation<T extends ValidatableRecord>(
  entity: T,
  before: T,
  critical: (keyof T)[],
): boolean {
  if (before.validationStatus !== GrowthValidationStatus.VALIDATED)
    return false;
  const changed = critical.some(
    (k) => JSON.stringify(entity[k]) !== JSON.stringify(before[k]),
  );
  if (changed) {
    entity.validationStatus = GrowthValidationStatus.PENDING_REVIEW;
    entity.validationTakenByUserId = null;
  }
  return changed;
}

/** Filtros comunes + visibilidad para las listas. */
export function applyProspectFilter<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  kind: GrowthProspectKind,
  filter: GrowthProspectFilterInput,
  guards: ProspectGuardsService,
  actor: JwtAccessPayload,
  searchColumns: string[],
): void {
  qb.andWhere('e.deleted_at IS NULL');
  // Los registros absorbidos en una fusión solo aparecen si se piden
  // explícitamente (estado DUPLICATE).
  if (!filter.statuses?.includes(GrowthValidationStatus.DUPLICATE)) {
    qb.andWhere('e.merged_into_id IS NULL');
  }
  const scoreColumn =
    kind === GrowthProspectKind.ORGANIZATION
      ? 'organization_id'
      : kind === GrowthProspectKind.PERSON
        ? 'person_id'
        : null;
  if (filter.priority && scoreColumn) {
    qb.andWhere(
      `EXISTS (SELECT 1 FROM growth.prospect_scores ps WHERE ps.${scoreColumn} = e.id AND ps.priority = :priority)`,
      { priority: filter.priority },
    );
  }
  if (filter.orderByScore && scoreColumn) {
    // Subconsulta (sin JOIN): la paginación con joins + orderBy rompe en TypeORM.
    qb.orderBy(
      `(SELECT ps.score FROM growth.prospect_scores ps WHERE ps.${scoreColumn} = e.id)`,
      'DESC',
      'NULLS LAST',
    );
  }
  const scope = guards.scope(kind, 'e', actor);
  if (scope) qb.andWhere(scope.sql, scope.params);

  if (filter.statuses?.length) {
    qb.andWhere('e.validation_status IN (:...statuses)', {
      statuses: filter.statuses,
    });
  }
  if (filter.locality && kind !== GrowthProspectKind.PERSON) {
    qb.andWhere('e.locality = :locality', { locality: filter.locality });
  }
  if (filter.independentOnly && kind === GrowthProspectKind.PERSON) {
    qb.andWhere('e.is_independent_admin = true');
  }
  if (filter.assignedTeamMemberId) {
    const column = PROSPECT_TARGETS[kind].assignmentColumn;
    qb.andWhere(
      `EXISTS (SELECT 1 FROM growth.prospect_assignments fa
                WHERE fa.${column} = e.id AND fa.ended_at IS NULL
                  AND fa.team_member_id = :assignee)`,
      { assignee: filter.assignedTeamMemberId },
    );
  }
  if (filter.search?.trim()) {
    const term = `%${stripAccents(filter.search.trim()).toLowerCase()}%`;
    qb.andWhere(
      `(${searchColumns.map((c) => `lower(${c}) LIKE :term`).join(' OR ')})`,
      { term },
    );
  }
}

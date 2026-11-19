import {
  Args,
  ID,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { HttpStatus } from '@nestjs/common';
import { ValidPermissions as P } from '../../../permissions/enums/valid-permissions';
import { Auth } from '../../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { PaginationInput } from '../../../shared/dto/inputs/pagination.input';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../../shared/utils/errors.utils';
import { actorHas } from '../../shared/growth-actor';
import { GrowthErrorCode } from '../../shared/growth-error-codes';
import {
  GrowthImportBatchFilterInput,
  GrowthImportRowDecisionInput,
  GrowthImportRowFilterInput,
  GrowthMapImportInput,
} from '../dto/inputs/import.inputs';
import {
  GrowthImportFieldCatalog,
  GrowthImportPreview,
  PaginatedGrowthImportBatches,
  PaginatedGrowthImportRows,
} from '../dto/responses/import.responses';
import {
  ImportBatch,
  ImportDuplicateHint,
  ImportRow,
} from '../entities/import.entities';
import { GrowthImportTarget } from '../imports.enums';
import { IMPORT_FIELDS } from '../shared/field-catalog';
import { ImportsService } from '../services/imports.service';

/**
 * Importaciones CSV/XLSX (la subida y el informe van por REST, ver
 * GrowthImportsController). Todo exige IMPORT_GROWTH_DATA.
 */
@Resolver()
export class GrowthImportsResolver {
  constructor(private readonly imports: ImportsService) {}

  @Auth({ permissions: [P.IMPORT_GROWTH_DATA] })
  @Query(() => [GrowthImportFieldCatalog], { name: 'growthImportFieldCatalog' })
  growthImportFieldCatalog(): GrowthImportFieldCatalog[] {
    return Object.values(GrowthImportTarget).map((target) => ({
      target,
      fields: IMPORT_FIELDS[target].map(({ field, label, required }) => ({
        field,
        label,
        required,
      })),
    }));
  }

  @Auth({ permissions: [P.IMPORT_GROWTH_DATA] })
  @Query(() => PaginatedGrowthImportBatches, { name: 'growthImportBatches' })
  growthImportBatches(
    @CurrentUser() actor: JwtAccessPayload,
    @Args('filter', { nullable: true }) filter?: GrowthImportBatchFilterInput,
    @Args('pagination', { nullable: true }) pagination?: PaginationInput,
  ): Promise<PaginatedGrowthImportBatches> {
    return this.imports.list(
      actor,
      filter ?? {},
      pagination ?? { page: 1, limit: 25 },
    );
  }

  @Auth({ permissions: [P.IMPORT_GROWTH_DATA] })
  @Query(() => ImportBatch, { name: 'growthImportBatch' })
  growthImportBatch(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<ImportBatch> {
    return this.imports.get(id, actor);
  }

  @Auth({ permissions: [P.IMPORT_GROWTH_DATA] })
  @Query(() => GrowthImportPreview, {
    name: 'growthImportPreview',
    description: 'Encabezados, primeras 20 filas y mapeo sugerido',
  })
  growthImportPreview(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<GrowthImportPreview> {
    return this.imports.preview(id, actor);
  }

  @Auth({ permissions: [P.IMPORT_GROWTH_DATA] })
  @Query(() => PaginatedGrowthImportRows, { name: 'growthImportRows' })
  growthImportRows(
    @Args('batchId', { type: () => ID }) batchId: string,
    @CurrentUser() actor: JwtAccessPayload,
    @Args('filter', { nullable: true }) filter?: GrowthImportRowFilterInput,
    @Args('pagination', { nullable: true }) pagination?: PaginationInput,
  ): Promise<PaginatedGrowthImportRows> {
    return this.imports.rows(
      batchId,
      actor,
      filter ?? {},
      pagination ?? { page: 1, limit: 25 },
    );
  }

  @Auth({ permissions: [P.IMPORT_GROWTH_DATA] })
  @Mutation(() => ImportBatch, {
    name: 'growthMapImportColumns',
    description: 'Asigna columnas a campos y encola la validación',
  })
  growthMapImportColumns(
    @Args('input') input: GrowthMapImportInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<ImportBatch> {
    return this.imports.map(input, actor);
  }

  @Auth({ permissions: [P.IMPORT_GROWTH_DATA] })
  @Mutation(() => ImportRow, { name: 'growthSetImportRowDecision' })
  growthSetImportRowDecision(
    @Args('input') input: GrowthImportRowDecisionInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<ImportRow> {
    return this.imports.setRowDecision(input, actor);
  }

  @Auth({ permissions: [P.IMPORT_GROWTH_DATA] })
  @Mutation(() => ImportBatch, {
    name: 'growthCommitImport',
    description:
      'Crea (en estado NEW) o vincula las filas según su decisión. Corre en segundo plano.',
  })
  growthCommitImport(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<ImportBatch> {
    return this.imports.commit(id, actor);
  }

  @Auth({ permissions: [P.IMPORT_GROWTH_DATA] })
  @Mutation(() => ImportBatch, { name: 'growthCancelImport' })
  growthCancelImport(
    @Args('id', { type: () => ID }) id: string,
    @Args('reason') reason: string,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<ImportBatch> {
    assertReason(reason);
    return this.imports.cancel(id, reason, actor);
  }
}

@Resolver(() => ImportRow)
export class GrowthImportRowResolver {
  constructor(private readonly imports: ImportsService) {}

  /** Correos y teléfonos enmascarados sin VIEW_GROWTH_CONTACT_DATA. Vacío tras la purga. */
  @ResolveField(() => [String], {
    description: 'Valores originales por columna',
  })
  raw(
    @Parent() row: ImportRow,
    @CurrentUser() actor: JwtAccessPayload,
  ): string[] {
    return this.imports.visibleRaw(row.raw ?? [], actor);
  }

  /** Sin VIEW_ALL_GROWTH_PROSPECTS no se revelan ids de registros que el actor no ve. */
  @ResolveField(() => ImportDuplicateHint, { nullable: true })
  duplicateHint(
    @Parent() row: ImportRow,
    @CurrentUser() actor: JwtAccessPayload,
  ): ImportDuplicateHint | null {
    if (!row.duplicateHint) return null;
    return actorHas(actor, P.VIEW_ALL_GROWTH_PROSPECTS)
      ? row.duplicateHint
      : { ...row.duplicateHint, existingIds: [] };
  }

  @ResolveField(() => ID, { nullable: true })
  linkEntityId(
    @Parent() row: ImportRow,
    @CurrentUser() actor: JwtAccessPayload,
  ): string | null {
    if (!row.linkEntityId) return null;
    return actorHas(actor, P.VIEW_ALL_GROWTH_PROSPECTS) ||
      row.decidedByUserId === actor.sub
      ? row.linkEntityId
      : null;
  }
}

function assertReason(reason: string): void {
  if (!reason || reason.trim().length < 5 || reason.length > 500) {
    throw new CustomError({
      message: 'El motivo debe tener entre 5 y 500 caracteres',
      statusCode: HttpStatus.BAD_REQUEST,
      errorCode: GrowthErrorCode.GROWTH_INVALID_INPUT,
    });
  }
}

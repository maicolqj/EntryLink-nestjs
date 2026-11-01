import { Field, ID, ObjectType } from '@nestjs/graphql';
import { PaginationReponse } from '../../../../shared/dto/responses/pagination-object.response';
import {
  ImportBatch,
  ImportColumnMapping,
  ImportRow,
} from '../../entities/import.entities';
import { GrowthImportField, GrowthImportTarget } from '../../imports.enums';

@ObjectType('PaginatedGrowthImportBatches')
export class PaginatedGrowthImportBatches {
  @Field(() => [ImportBatch])
  items: ImportBatch[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}

@ObjectType('PaginatedGrowthImportRows')
export class PaginatedGrowthImportRows {
  @Field(() => [ImportRow])
  items: ImportRow[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}

@ObjectType('GrowthImportFieldDefinition')
export class GrowthImportFieldDefinition {
  @Field(() => GrowthImportField)
  field: GrowthImportField;

  @Field()
  label: string;

  @Field()
  required: boolean;
}

@ObjectType('GrowthImportFieldCatalog')
export class GrowthImportFieldCatalog {
  @Field(() => GrowthImportTarget)
  target: GrowthImportTarget;

  @Field(() => [GrowthImportFieldDefinition])
  fields: GrowthImportFieldDefinition[];
}

/** Lo que se necesita para el paso de mapeo. */
@ObjectType('GrowthImportPreview')
export class GrowthImportPreview {
  @Field(() => [String])
  headers: string[];

  @Field(() => [[String]], {
    description:
      'Primeras 20 filas (correos y teléfonos enmascarados sin VIEW_GROWTH_CONTACT_DATA)',
  })
  rows: string[][];

  @Field(() => [ImportColumnMapping], {
    description: 'Sugerencia automática por encabezado',
  })
  suggestedMapping: ImportColumnMapping[];

  @Field(() => [ID], {
    description: 'Lotes anteriores con el mismo archivo (sha256)',
  })
  previousBatchIds: string[];
}

import { Field, Int, ObjectType } from '@nestjs/graphql';
import { PaginationReponse } from '../../../../shared/dto/responses/pagination-object.response';
import { PaginationInput } from '../../../../shared/dto/inputs/pagination.input';
import { GrowthEntityType } from '../../../shared/growth.enums';
import { Organization } from '../../entities/organization.entity';
import { Person } from '../../entities/person.entity';
import { Property } from '../../entities/property.entity';
import {
  GrowthProspectKind,
  GrowthValidationStatus,
} from '../../prospects.enums';
import { ActivityEvent } from '../../../activity/entities/activity-event.entity';

@ObjectType('PaginatedGrowthOrganizations')
export class PaginatedGrowthOrganizations {
  @Field(() => [Organization])
  items: Organization[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}

@ObjectType('PaginatedGrowthPeople')
export class PaginatedGrowthPeople {
  @Field(() => [Person])
  items: Person[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}

@ObjectType('PaginatedGrowthProperties')
export class PaginatedGrowthProperties {
  @Field(() => [Property])
  items: Property[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}

export function paginate<T>(
  items: T[],
  totalItems: number,
  pagination: PaginationInput,
): { items: T[]; pagination: PaginationReponse } {
  const totalPages = Math.ceil(totalItems / pagination.limit);
  return {
    items,
    pagination: {
      currentPage: pagination.page,
      itemsPerPage: pagination.limit,
      totalItems,
      totalPages,
      hasNextPage: pagination.page < totalPages,
      hasPreviousPage: pagination.page > 1,
    },
  };
}

@ObjectType('GrowthChecklistItem')
export class GrowthChecklistItem {
  @Field()
  key: string;

  @Field()
  label: string;

  @Field()
  ok: boolean;
}

@ObjectType('GrowthValidationChecklist')
export class GrowthValidationChecklist {
  @Field(() => GrowthProspectKind)
  kind: GrowthProspectKind;

  @Field()
  id: string;

  @Field({ description: 'true si cumple todo lo necesario para VALIDATED' })
  ready: boolean;

  @Field(() => [GrowthChecklistItem])
  items: GrowthChecklistItem[];
}

@ObjectType('GrowthReviewItem')
export class GrowthReviewItem {
  @Field(() => GrowthProspectKind)
  kind: GrowthProspectKind;

  @Field()
  id: string;

  @Field()
  displayName: string;

  @Field(() => GrowthValidationStatus)
  validationStatus: GrowthValidationStatus;

  @Field({ nullable: true })
  validationTakenByUserId?: string | null;

  @Field()
  createdByUserId: string;

  @Field()
  updatedAt: Date;
}

@ObjectType('GrowthStatusCount')
export class GrowthStatusCount {
  @Field(() => GrowthValidationStatus)
  status: GrowthValidationStatus;

  @Field(() => Int)
  count: number;
}

@ObjectType('GrowthKindStats')
export class GrowthKindStats {
  @Field(() => Int)
  total: number;

  @Field(() => [GrowthStatusCount])
  byStatus: GrowthStatusCount[];
}

@ObjectType('GrowthProspectDashboard')
export class GrowthProspectDashboard {
  @Field(() => Int, { description: 'Meta de prospectos validados' })
  goal: number;

  @Field(() => Int, {
    description: 'Empresas + administradores independientes VALIDATED',
  })
  validatedProspects: number;

  @Field(() => Int, { description: 'PENDING_REVIEW + IN_VALIDATION' })
  pendingValidation: number;

  @Field(() => GrowthKindStats)
  organizations: GrowthKindStats;

  @Field(() => GrowthKindStats)
  independentAdmins: GrowthKindStats;

  @Field(() => GrowthKindStats)
  properties: GrowthKindStats;

  @Field(() => Int, {
    description: 'Unidades de copropiedades VALIDATED (dato verificado)',
  })
  verifiedUnits: number;

  @Field(() => Int, {
    description: 'Unidades estimadas de copropiedades sin validar (estimado)',
  })
  estimatedUnits: number;

  @Field(() => [ActivityEvent])
  recentActivity: ActivityEvent[];
}

export type ProspectEntityType =
  | GrowthEntityType.ORGANIZATION
  | GrowthEntityType.PERSON
  | GrowthEntityType.PROPERTY;

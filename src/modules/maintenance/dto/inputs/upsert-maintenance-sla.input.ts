import { InputType, Field, Int } from '@nestjs/graphql';
import { IsEnum, IsInt, IsUUID, Max, Min } from 'class-validator';

import { MaintenanceCategory } from '../../enums/maintenance-category.enum';
import { MaintenancePriority } from '../../enums/maintenance-priority.enum';

/**
 * Un renglón de la política de plazos. Es upsert por (categoría, prioridad):
 * la combinación es la llave natural y crear duplicados solo serviría para que
 * dos filas se contradigan sobre el mismo caso.
 */
@InputType()
export class UpsertMaintenanceSlaInput {
  @Field(() => String)
  @IsUUID()
  complexId: string;

  @Field(() => MaintenanceCategory)
  @IsEnum(MaintenanceCategory)
  category: MaintenanceCategory;

  @Field(() => MaintenancePriority)
  @IsEnum(MaintenancePriority)
  priority: MaintenancePriority;

  @Field(() => Int, { description: 'Horas para asignar responsable' })
  @IsInt()
  @Min(1)
  @Max(8760)
  responseHours: number;

  @Field(() => Int, { description: 'Horas para dejarlo reparado' })
  @IsInt()
  @Min(1)
  @Max(8760)
  resolutionHours: number;
}

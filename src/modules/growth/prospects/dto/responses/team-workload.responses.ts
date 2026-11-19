import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { GrowthTeamMemberStatus } from '../../../shared/growth.enums';
import { GrowthValidationStatus } from '../../prospects.enums';

@ObjectType('GrowthWorkloadStatusCount')
export class GrowthWorkloadStatusCount {
  @Field(() => GrowthValidationStatus) status: GrowthValidationStatus;
  @Field(() => Int) count: number;
}

@ObjectType('GrowthTeamWorkload', {
  description:
    'Carga de un integrante: asignaciones VIGENTES (sin fecha de cierre), el mismo conteo que aplica el tope de asignación. organizations + people + properties = activeAssignments; la suma de byValidationStatus + staleAssignments = activeAssignments.',
})
export class GrowthTeamWorkload {
  @Field(() => ID) teamMemberId: string;
  @Field(() => ID) userId: string;
  @Field() displayName: string;
  @Field(() => GrowthTeamMemberStatus) status: GrowthTeamMemberStatus;

  @Field(() => Int, {
    nullable: true,
    description: 'Tope del integrante: asignar por encima de él se rechaza',
  })
  maxActiveAssignments?: number | null;

  @Field(() => Int, { description: 'Asignaciones vigentes' })
  activeAssignments: number;

  @Field(() => Int) organizations: number;
  @Field(() => Int) people: number;
  @Field(() => Int) properties: number;

  @Field(() => [GrowthWorkloadStatusCount], {
    description:
      'Asignaciones vigentes de prospectos vivos por estado de validación; solo estados con al menos una',
  })
  byValidationStatus: GrowthWorkloadStatusCount[];

  @Field(() => Int, {
    description:
      'Asignaciones vigentes cuyo puntaje guardado tiene prioridad HIGH (copropiedades no tienen puntaje)',
  })
  highPriority: number;

  @Field(() => Int, {
    description:
      'Vigentes sobre un registro borrado o fusionado (normalmente 0); cuentan para el tope',
  })
  staleAssignments: number;
}

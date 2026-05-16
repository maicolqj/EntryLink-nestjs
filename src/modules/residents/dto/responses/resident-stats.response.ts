import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType()
export class ResidentStatusBreakdown {
  @Field(() => Int) active: number;
  @Field(() => Int) pendingApproval: number;
  @Field(() => Int) suspended: number;
  @Field(() => Int) movedOut: number;
  @Field(() => Int) rejected: number;
}

@ObjectType()
export class ResidentTypeBreakdown {
  @Field(() => Int) owners: number;
  @Field(() => Int) tenants: number;
  @Field(() => Int) familyMembers: number;
  @Field(() => Int) caretakers: number;
}

@ObjectType({ description: 'Estadísticas del módulo de residentes para un complejo' })
export class ResidentStatsResponse {
  @Field(() => Int, { description: 'Total de registros activos (no eliminados)' })
  total: number;

  @Field(() => Int, { description: 'Residentes activos y verificados' })
  active: number;

  @Field(() => Int, { description: 'Solicitudes pendientes de aprobación' })
  pendingApproval: number;

  @Field(() => Int, { description: 'Residentes actualmente suspendidos' })
  suspended: number;

  @Field(() => Int, { description: 'Residentes que se mudaron' })
  movedOut: number;

  @Field(() => Int, { description: 'Solicitudes rechazadas' })
  rejected: number;

  @Field(() => Int, { description: 'Residentes principales activos (uno por unidad)' })
  mainResidents: number;

  @Field(() => ResidentTypeBreakdown, { description: 'Desglose por tipo de residente (solo activos)' })
  byType: ResidentTypeBreakdown;
}

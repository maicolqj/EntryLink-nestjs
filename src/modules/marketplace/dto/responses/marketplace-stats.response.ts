import { ObjectType, Field, Int } from '@nestjs/graphql';

/** Los números del encabezado del tablero de la administración. */
@ObjectType({ description: 'Resumen del módulo de clasificados' })
export class MarketplaceStatsResponse {
  @Field(() => Int, { description: 'Publicadas y vigentes' })
  published: number;

  @Field(() => Int, { description: 'Esperando aprobación' })
  pendingReview: number;

  @Field(() => Int, { description: 'Pausadas, por su dueño o por reportes' })
  paused: number;

  @Field(() => Int, { description: 'Reportes sin resolver' })
  pendingReports: number;

  @Field(() => Int, { description: 'Vencen en los próximos 7 días' })
  expiringSoon: number;
}

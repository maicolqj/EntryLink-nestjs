import { ObjectType, Field, Float, Int } from '@nestjs/graphql';

@ObjectType()
export class RecurringCausationResult {

  /** Cargos (facturas) causados en esta corrida. */
  @Field(() => Int)
  caused: number;

  /** Recurrentes/unidades omitidos (ya causados, no vencen hoy, etc.). */
  @Field(() => Int)
  skipped: number;

  @Field(() => Float)
  totalAmount: number;
}

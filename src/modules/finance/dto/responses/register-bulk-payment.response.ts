import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType()
export class RegisterBulkPaymentResponse {

  /** Total de cargos pagados (cargo base + meses adelantados) */
  @Field(() => Int)
  paid: number;

  /** Total de cargos nuevos creados (solo los meses adelantados) */
  @Field(() => Int)
  created: number;
}

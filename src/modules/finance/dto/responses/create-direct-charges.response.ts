import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType()
export class CreateDirectChargesResponse {

  @Field(() => Int)
  created: number;

  /** Cargos omitidos por ser duplicados (mismo complexId+unitId+period+description) */
  @Field(() => Int)
  skipped: number;
}

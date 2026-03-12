import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType()
export class GenerateChargesResponse {

  @Field(() => Int)
  generated: number;   // Cargos nuevos creados

  @Field(() => Int)
  skipped: number;     // Cargos omitidos (ya existían)

  @Field()
  period: string;
}

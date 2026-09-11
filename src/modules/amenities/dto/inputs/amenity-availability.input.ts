import { InputType, Field } from '@nestjs/graphql';
import { IsUUID, Matches } from 'class-validator';

/** Fecha calendario YYYY-MM-DD en hora local del complejo. */
const YYYYMMDD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

@InputType()
export class AmenityAvailabilityInput {

  @Field()
  @IsUUID()
  amenityId: string;

  @Field(() => String, { description: 'Primer día a consultar (YYYY-MM-DD)' })
  @Matches(YYYYMMDD, { message: 'from debe tener formato YYYY-MM-DD' })
  from: string;

  @Field(() => String, { description: 'Último día a consultar, inclusive (YYYY-MM-DD)' })
  @Matches(YYYYMMDD, { message: 'to debe tener formato YYYY-MM-DD' })
  to: string;
}

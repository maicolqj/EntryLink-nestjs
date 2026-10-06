import { Field, ObjectType } from '@nestjs/graphql';

import { ComplexStatus } from '../../enums/complex-status.enum';

/**
 * Lo que la pantalla de suspensión necesita saber. Va aparte de
 * ResidentialComplex porque el motivo no es para residentes ni portería.
 */
@ObjectType({ description: 'Estado de suspensión manual de un complejo' })
export class ComplexSuspensionInfo {
  @Field(() => String)
  complexId: string;

  @Field(() => String)
  complexName: string;

  @Field(() => ComplexStatus)
  status: ComplexStatus;

  @Field(() => Boolean, {
    description: 'true si la plataforma suspendió la cuenta del conjunto',
  })
  suspended: boolean;

  @Field(() => String, {
    nullable: true,
    description: 'Motivo que escribió la plataforma al suspender',
  })
  reason?: string | null;

  @Field(() => Date, { nullable: true })
  suspendedAt?: Date | null;
}

import { ObjectType, Field } from '@nestjs/graphql';

/** Un consejero, visto desde la configuración de quién responde los PQRF. */
@ObjectType({ description: 'Miembro del consejo y si responde los PQRF' })
export class PqrfCouncilMember {

  @Field(() => String)
  userId: string;

  @Field(() => String)
  name: string;

  /** "Torre 2 · 301" o solo el número si el complejo no tiene torres. */
  @Field(() => String, { nullable: true })
  unitLabel?: string | null;

  @Field(() => Boolean, { description: 'Le toca responder los PQRF dirigidos al consejo' })
  canResolve: boolean;
}

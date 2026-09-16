import { ObjectType, Field } from '@nestjs/graphql';

/** Un consejero, visto desde la configuración de voz y voto. */
@ObjectType({ description: 'Miembro del consejo y si vota en sus reuniones' })
export class VotingCouncilMember {
  @Field(() => String)
  userId: string;

  @Field(() => String)
  name: string;

  /** "Torre 2 · 301" o solo el número si el complejo no tiene torres. */
  @Field(() => String, { nullable: true })
  unitLabel?: string | null;

  @Field(() => Boolean, { description: 'Tiene voto; si no, solo voz' })
  hasVote: boolean;
}

import { ObjectType, Field, Int, Float } from '@nestjs/graphql';

import { VoteWeighting } from '../../enums/voting.enums';

@ObjectType({ description: 'Resultado de una opción' })
export class VotingOptionResult {

  @Field(() => String)
  optionId: string;

  @Field(() => String)
  text: string;

  @Field(() => Int, { description: 'Cuántas unidades o consejeros la eligieron' })
  votes: number;

  @Field(() => Float, { description: 'Suma de pesos: coeficientes, unidades o consejeros' })
  weight: number;

  @Field(() => Float, { description: 'Fracción de los votos emitidos (0 a 1)' })
  share: number;

  /**
   * Fracción de todos los habilitados, hayan votado o no. Es la que cuenta
   * para las mayorías calificadas de la Ley 675 (p. ej. 70 % de coeficientes).
   */
  @Field(() => Float, { description: 'Fracción del total habilitado para votar (0 a 1)' })
  shareOfEligible: number;
}

/** Un voto en una pregunta nominal, tal como va al acta. */
@ObjectType({ description: 'Voto nominal: quién votó qué' })
export class VotingBallotView {

  @Field(() => String, { description: 'Unidad ("Torre 2 · 301") o nombre del consejero' })
  voterLabel: string;

  @Field(() => String, { nullable: true, description: 'Persona que registró el voto' })
  voterName?: string | null;

  @Field(() => String)
  optionText: string;

  @Field(() => Float)
  weight: number;

  @Field(() => Date)
  votedAt: Date;
}

@ObjectType({ description: 'Resultados de una pregunta' })
export class VotingResults {

  @Field(() => VoteWeighting)
  weighting: VoteWeighting;

  @Field(() => Int, { description: 'Unidades o consejeros habilitados' })
  eligibleCount: number;

  @Field(() => Float, { description: 'Peso total habilitado (suma de coeficientes, unidades o consejeros)' })
  eligibleWeight: number;

  @Field(() => Int)
  votedCount: number;

  @Field(() => Float)
  votedWeight: number;

  @Field(() => Float, { description: 'Peso que votó sobre el habilitado (0 a 1)' })
  participation: number;

  @Field(() => [VotingOptionResult])
  options: VotingOptionResult[];

  /** Solo la administración, y solo en preguntas nominales. */
  @Field(() => [VotingBallotView], { nullable: true })
  ballots?: VotingBallotView[] | null;

  /** Solo la administración en preguntas secretas: quién participó, sin su voto. */
  @Field(() => [String], { nullable: true })
  participants?: string[] | null;
}

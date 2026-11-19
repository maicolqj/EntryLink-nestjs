import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';
import { GrowthMergeSide, GrowthProspectKind } from '../../prospects.enums';

export enum GrowthMergeFieldOutcome {
  /** Iguales, o los dos vacíos. */
  SAME = 'SAME',
  /** Solo el sobreviviente tiene valor: se conserva. */
  SURVIVOR_ONLY = 'SURVIVOR_ONLY',
  /** El sobreviviente está vacío: se toma el del absorbido sin preguntar. */
  FROM_MERGED = 'FROM_MERGED',
  /** Valores distintos en ambos: hay que elegir lado. */
  CONFLICT = 'CONFLICT',
}
registerEnumType(GrowthMergeFieldOutcome, {
  name: 'GrowthMergeFieldOutcome',
});

@ObjectType('GrowthMergeFieldPreview')
export class GrowthMergeFieldPreview {
  @Field() field: string;
  @Field(() => GraphQLJSON, { nullable: true }) survivorValue: unknown;
  @Field(() => GraphQLJSON, { nullable: true }) mergedValue: unknown;
  @Field(() => GrowthMergeFieldOutcome) outcome: GrowthMergeFieldOutcome;

  @Field(() => GrowthMergeSide, {
    nullable: true,
    description: 'Lado elegido (solo en CONFLICT con elección)',
  })
  chosenSide: GrowthMergeSide | null;

  @Field(() => GraphQLJSON, {
    nullable: true,
    description:
      'Valor que quedará en el sobreviviente; null en un CONFLICT sin elegir',
  })
  resultValue: unknown;
}

@ObjectType('GrowthMergeMoveCount')
export class GrowthMergeMoveCount {
  @Field({
    description:
      'assignments, evidences, channels, employments, managements, responsibleOf o candidatesClosed',
  })
  key: string;

  @Field(() => Int) count: number;
}

@ObjectType('GrowthMergePreview', {
  description:
    'Lo que haría growthMergeDuplicates con estos datos, calculado con la misma lógica. No modifica nada.',
})
export class GrowthMergePreview {
  @Field(() => ID) candidateId: string;
  @Field(() => GrowthProspectKind) entityType: GrowthProspectKind;
  @Field(() => ID) survivorId: string;
  @Field(() => ID) mergedId: string;

  @Field(() => [GrowthMergeFieldPreview], {
    description: 'Todos los campos combinables, en orden',
  })
  fields: GrowthMergeFieldPreview[];

  @Field(() => [String], {
    description: 'Conflictos sin elección: la fusión los rechazaría',
  })
  missingChoices: string[];

  @Field({ description: 'true si la fusión se puede confirmar así' })
  ready: boolean;

  @Field(() => [GrowthMergeMoveCount], {
    description:
      'Registros del absorbido que pasan al sobreviviente; candidatesClosed = otros pares pendientes que se descartan',
  })
  moves: GrowthMergeMoveCount[];

  @Field({
    description:
      'Ambos tienen responsable vigente: el del absorbido se cierra y queda en el historial',
  })
  assignmentClosed: boolean;

  @Field({
    description:
      'Copropiedades: ambas con administración vigente; la del absorbido pasa a historial',
  })
  managementEnded: boolean;

  @Field({
    description:
      'El sobreviviente está VALIDATED y cambia un campo crítico: vuelve a PENDING_REVIEW',
  })
  revalidation: boolean;

  @Field({
    description:
      'Personas: la autorización de contacto del sobreviviente se revoca',
  })
  survivorContactRevoked: boolean;

  @Field({
    description:
      'Personas: la autorización de contacto del absorbido se revoca',
  })
  mergedContactRevoked: boolean;
}

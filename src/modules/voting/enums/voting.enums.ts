import { registerEnumType } from '@nestjs/graphql';

/** Tipo de reunión. Decide quién vota: la copropiedad o el consejo. */
export enum VotingMeetingKind {
  ASAMBLEA = 'ASAMBLEA',
  CONSEJO  = 'CONSEJO',
}

/**
 * Cuánto pesa cada voto.
 *
 * - COEFFICIENT: la unidad vale su coeficiente de copropiedad (Ley 675).
 * - UNIT: una unidad, un voto, sin importar su tamaño.
 * - MEMBER: un consejero, un voto. Es el único válido en reuniones del consejo.
 */
export enum VoteWeighting {
  COEFFICIENT = 'COEFFICIENT',
  UNIT        = 'UNIT',
  MEMBER      = 'MEMBER',
}

/** NOMINAL: la administración ve qué votó cada quien. SECRET: solo totales. */
export enum VoteSecrecy {
  NOMINAL = 'NOMINAL',
  SECRET  = 'SECRET',
}

/** DRAFT se edita; OPEN recibe votos; CLOSED es definitivo. */
export enum VotingQuestionStatus {
  DRAFT  = 'DRAFT',
  OPEN   = 'OPEN',
  CLOSED = 'CLOSED',
}

/**
 * A quién se le muestran las votaciones. Son dos interruptores distintos: una
 * reunión del consejo no obliga a abrirle el módulo a toda la copropiedad.
 */
export enum VotingAudience {
  RESIDENTS = 'RESIDENTS',
  COUNCIL   = 'COUNCIL',
}

registerEnumType(VotingAudience, {
  name: 'VotingAudience',
  description: 'Residentes (asambleas) o consejo (sus reuniones)',
});

registerEnumType(VotingMeetingKind, {
  name: 'VotingMeetingKind',
  description: 'Asamblea de copropietarios o reunión del consejo',
});

registerEnumType(VoteWeighting, {
  name: 'VoteWeighting',
  description: 'Peso del voto: coeficiente, una unidad un voto, o un consejero un voto',
});

registerEnumType(VoteSecrecy, {
  name: 'VoteSecrecy',
  description: 'Voto nominal (se sabe quién votó qué) o secreto (solo totales)',
});

registerEnumType(VotingQuestionStatus, {
  name: 'VotingQuestionStatus',
  description: 'Borrador, abierta a votos o cerrada',
});

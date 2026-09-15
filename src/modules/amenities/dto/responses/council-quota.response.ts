import { ObjectType, Field, Int } from '@nestjs/graphql';

/**
 * Cupo anual del consejo de administración que le queda a quien pregunta, en
 * una zona concreta.
 *
 * Existe como consulta aparte y no como campo de `Amenity` porque contar las
 * reservas del año es una consulta por zona y por persona: resolverlo dentro
 * del listado de zonas costaría una consulta por cada fila.
 */
@ObjectType({
  description: 'Cupo anual del consejo de administración en una zona común',
})
export class AmenityCouncilQuotaResponse {
  @Field(() => Boolean, {
    description: 'Quien pregunta está marcado como miembro del consejo',
  })
  isCouncilMember: boolean;

  @Field(() => Int, {
    description:
      'Reservas gratis al año que concede la zona. 0 = no concede el beneficio',
  })
  bookingsPerYear: number;

  @Field(() => Int, {
    description: 'Cuántas lleva usadas este año en esta zona',
  })
  used: number;

  @Field(() => Int, { description: 'Cuántas le quedan este año en esta zona' })
  remaining: number;

  @Field(() => Int, { description: 'Año calendario sobre el que se cuenta' })
  year: number;
}

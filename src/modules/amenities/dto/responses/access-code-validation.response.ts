import { ObjectType, Field } from '@nestjs/graphql';

import { AmenityBooking } from '../../entities/amenity-booking.entity';

/**
 * Resultado de validar en portería el código de ingreso de una reserva, SIN
 * registrar nada.
 *
 * El guarda necesita ver a quién pertenece el código antes de abrir: la zona,
 * la unidad, la franja y cuántos vienen. Registrar el ingreso a ciegas deja
 * pasar a quien trae el código de otro, y un ingreso mal registrado ya no se
 * puede deshacer desde portería.
 */
@ObjectType({
  description: 'Validación del código de ingreso de una reserva de zona común',
})
export class AmenityAccessCodeValidation {
  @Field(() => AmenityBooking, {
    description: 'La reserva a la que pertenece el código',
  })
  booking: AmenityBooking;

  @Field(() => Boolean, {
    description: 'El ingreso se puede registrar ahora mismo',
  })
  canCheckIn: boolean;

  @Field(() => Boolean, {
    description: 'Ya tiene ingreso registrado: lo que procede es la salida',
  })
  canCheckOut: boolean;

  @Field(() => String, {
    nullable: true,
    description:
      'Por qué no procede el ingreso, en palabras para el guarda. Null si procede',
  })
  reason?: string | null;

  @Field(() => String, {
    nullable: true,
    description:
      'Código de error del motivo, el mismo que devolvería el ingreso',
  })
  reasonCode?: string | null;

  @Field(() => Date, {
    description: 'Desde cuándo se admite el ingreso (inicio menos la gracia)',
  })
  checkInOpensAt: Date;
}

import { InputType, Field, Int } from '@nestjs/graphql';
import { IsUUID, IsOptional, IsInt, Min, Max, IsBoolean } from 'class-validator';

/** Tope de la franja de aseo: un día entero. Más que eso es un bloqueo, no un aseo. */
export const MAX_CLEANING_MINUTES = 24 * 60;

/**
 * Ajuste del aseo de una reserva, hecho por la administración.
 *
 * Los dos campos son opcionales y se aplican por separado: cambiar quién asea
 * no obliga a redefinir la franja, y alargar la franja no cambia quién la hace.
 */
@InputType()
export class UpdateAmenityBookingCleaningInput {
  @Field()
  @IsUUID()
  bookingId: string;

  @Field(() => Int, {
    nullable: true,
    description:
      'Minutos que la zona queda bloqueada tras la reserva. 0 = sin franja',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_CLEANING_MINUTES)
  cleaningMinutes?: number;

  @Field(() => Boolean, {
    nullable: true,
    description: 'true = asea el conjunto y se cobra; false = asea la unidad',
  })
  @IsOptional()
  @IsBoolean()
  cleaningByComplex?: boolean;
}

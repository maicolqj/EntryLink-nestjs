import { InputType, Field, Float } from '@nestjs/graphql';
import { IsUUID, IsNumber, IsPositive, IsString, IsNotEmpty, MaxLength } from 'class-validator';

/**
 * Cobro por daños tras entregar la zona común.
 *
 * No hay depósito: la unidad no adelanta dinero. Si al recibir la zona se
 * evidencia un daño, el valor se le carga a la unidad en finanzas, igual que el
 * parqueadero de visitantes no pagado. Si no hay daño, no se cobra nada.
 *
 * La descripción es obligatoria: un cargo que aparece en el estado de cuenta sin
 * explicación es un cargo que el residente va a reclamar con razón.
 */
@InputType()
export class ChargeAmenityDamageInput {

  @Field()
  @IsUUID()
  bookingId: string;

  @Field(() => Float, { description: 'Valor a cargar a la unidad' })
  @IsNumber()
  @IsPositive()
  amount: number;

  @Field(() => String, { description: 'Qué se dañó y por qué se cobra. Lo ve el residente en su estado de cuenta' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description: string;
}

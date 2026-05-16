import { InputType, Field, Float, Int } from '@nestjs/graphql';
import { IsEnum, IsNotEmpty, IsOptional, IsPositive, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { ParkingRateType } from '../../enums/parking-rate-type.enum';

@InputType({ description: 'Datos para crear o actualizar la configuración de tarifas del parqueadero' })
export class SaveParkingConfigInput {

  @Field(() => ParkingRateType, { description: 'Tipo de tarifa' })
  @IsEnum(ParkingRateType)
  rateType: ParkingRateType;

  @Field(() => Float, { description: 'Valor unitario de la tarifa' })
  @IsPositive()
  rateAmount: number;

  @Field(() => Int, { description: 'Minutos de gracia sin cobro', nullable: true })
  @IsOptional()
  @Min(0)
  gracePeriodMinutes?: number;

  @Field(() => Float, { description: 'Tope máximo de cobro por día', nullable: true })
  @IsOptional()
  @IsPositive()
  maxDailyAmount?: number;

  @Field(() => String, { description: 'Moneda (ISO 4217). Default: COP', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @Field(() => String, { description: 'ID del complejo' })
  @IsUUID()
  @IsNotEmpty()
  complexId: string;
}

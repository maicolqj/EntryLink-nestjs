import { InputType, Field, Int, Float } from '@nestjs/graphql';
import { IsUUID, IsOptional, IsString, IsInt, IsBoolean, IsNumber, Min, MaxLength, IsEnum } from 'class-validator';
import { ParkingRateType } from '../../enums/parking-rate-type.enum';

@InputType({ description: 'Datos para crear/actualizar una tarifa de parqueadero visitante' })
export class VisitorParkingRateInput {

  @Field(() => String, { nullable: true, description: 'ID de la tarifa a actualizar (omitir para crear nueva)' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @Field(() => String)
  @IsString()
  @MaxLength(100)
  name: string;

  @Field(() => ParkingRateType, { description: 'Tipo de tarifa aplicada' })
  @IsEnum(ParkingRateType)
  type: ParkingRateType;

  @Field(() => Float)
  @IsNumber()
  @Min(0)
  amount: number;

  @Field(() => String)
  @IsString()
  @MaxLength(10)
  currency: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @Field(() => Boolean, { defaultValue: true })
  @IsBoolean()
  isActive: boolean;
}

@InputType({ description: 'Datos para crear/actualizar la configuración del parqueadero visitante' })
export class UpdateVisitorParkingConfigInput {

  @Field(() => String, { description: 'ID del complejo residencial' })
  @IsUUID()
  complexId: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxCapacity?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  gracePeriodMinutes?: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  receiptMessage?: string;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  showLogoOnReceipt?: boolean;

  @Field(() => String, { nullable: true, description: 'UUID de la tarifa activa por defecto' })
  @IsOptional()
  @IsUUID()
  activeRateId?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @Field(() => [VisitorParkingRateInput], { nullable: true, description: 'Tarifas a crear o actualizar' })
  @IsOptional()
  rates?: VisitorParkingRateInput[];
}

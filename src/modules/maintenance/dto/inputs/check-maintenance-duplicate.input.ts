import { InputType, Field, Int, Float } from '@nestjs/graphql';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { MaintenanceCategory } from '../../enums/maintenance-category.enum';
import { MaintenanceLocationType } from '../../enums/maintenance-location-type.enum';

/**
 * Lo que la app pregunta ANTES de abrir el formulario: "¿esto ya está
 * reportado?". Lleva la ubicación tal como la va a mandar el ticket para que la
 * comparación sea contra el mismo sitio y no contra una aproximación.
 */
@InputType()
export class CheckMaintenanceDuplicateInput {
  @Field(() => String)
  @IsUUID()
  complexId: string;

  @Field(() => MaintenanceCategory)
  @IsEnum(MaintenanceCategory)
  category: MaintenanceCategory;

  @Field(() => MaintenanceLocationType)
  @IsEnum(MaintenanceLocationType)
  locationType: MaintenanceLocationType;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  locationTagCode?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  buildingId?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(-10)
  @Max(200)
  floor?: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  amenityId?: string;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  gpsAccuracyMeters?: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  locationText?: string;
}

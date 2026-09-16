import {
  InputType,
  Field,
  Int,
  Float,
  PartialType,
  OmitType,
} from '@nestjs/graphql';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { MaintenanceTagKind } from '../../enums/maintenance-tag-kind.enum';
import { MaintenanceCategory } from '../../enums/maintenance-category.enum';

@InputType()
export class CreateMaintenanceLocationTagInput {
  @Field(() => String)
  @IsUUID()
  complexId: string;

  /**
   * Lo que se manda a imprimir en el sticker. Se limita a letras, dígitos,
   * guion y guion bajo porque termina dentro de una URL de QR y porque alguien
   * lo va a teclear a mano cuando el sticker se despegue.
   */
  @Field(() => String)
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'El código solo admite letras, números, guion y guion bajo',
  })
  code: string;

  @Field(() => String)
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  name: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @Field(() => MaintenanceTagKind, { nullable: true })
  @IsOptional()
  @IsEnum(MaintenanceTagKind)
  kind?: MaintenanceTagKind;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  buildingId?: string;

  @Field(() => Int, { nullable: true, description: 'Negativo para sótanos' })
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

  @Field(() => MaintenanceCategory, { nullable: true })
  @IsOptional()
  @IsEnum(MaintenanceCategory)
  defaultCategory?: MaintenanceCategory;
}

/**
 * El `code` queda fuera a propósito: está impreso en cien stickers pegados por
 * todo el conjunto. Cambiarlo desde una pantalla dejaría esos stickers
 * apuntando a un punto que ya no existe.
 */
@InputType()
export class UpdateMaintenanceLocationTagInput extends PartialType(
  OmitType(CreateMaintenanceLocationTagInput, ['code', 'complexId'] as const),
) {
  @Field(() => String)
  @IsUUID()
  id: string;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

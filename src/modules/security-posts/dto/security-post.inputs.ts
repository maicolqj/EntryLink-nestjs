import { Field, InputType, Int } from '@nestjs/graphql';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const PHONE = /^\+?[0-9\s-]{7,30}$/;

@InputType()
export class CreateSecurityPostInput {
  @Field(() => String)
  @IsUUID()
  complexId: string;

  @Field(() => String, { description: 'Ej. "Portería norte"' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @Field(() => String, {
    nullable: true,
    description: 'Línea del celular de esa portería (opcional)',
  })
  @IsOptional()
  @Matches(PHONE, { message: 'Teléfono no válido' })
  phoneNumber?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

/**
 * Sin PartialType a propósito: con valores por defecto, la edición parcial
 * rellenaba campos que no se mandaron.
 */
@InputType()
export class UpdateSecurityPostInput {
  @Field(() => String)
  @IsUUID()
  id: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @Field(() => String, {
    nullable: true,
    description: 'Vacío ("") para quitar el teléfono',
  })
  @IsOptional()
  @Matches(/^$|^\+?[0-9\s-]{7,30}$/, { message: 'Teléfono no válido' })
  phoneNumber?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

import {
  IsBoolean,
  IsEnum,
  IsEmail,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ComplexType } from '../../enums/complex-type.enum';

export class RegisterComplexDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsEnum(ComplexType)
  type: ComplexType;

  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @IsPositive()
  totalUnits: number;

  @IsOptional()
  @Transform(({ value }) => (value !== undefined && value !== '' ? parseInt(value, 10) : undefined))
  @IsInt()
  @IsPositive()
  numberOfTowers?: number;

  @IsString()
  @MaxLength(255)
  legalRepresentativeName: string;

  @IsEmail()
  email: string;

  @IsString()
  @Matches(/^\d{7,15}$/, { message: 'El teléfono debe tener entre 7 y 15 dígitos' })
  phone: string;

  /** Aceptación de Términos, Privacidad y DPA. Enviado como string en multipart. */
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  acceptedTerms: boolean;
}

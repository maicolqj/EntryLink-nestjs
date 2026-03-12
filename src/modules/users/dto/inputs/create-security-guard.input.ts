import { InputType, Field } from '@nestjs/graphql';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

@InputType({ description: 'Datos para crear un guardia de seguridad' })
export class CreateSecurityGuardInput {
  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;

  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @Matches(/^3\d{9}$/, { message: 'Número de celular colombiano inválido (ej: 3001234567)' })
  phoneNumber: string;

  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  identityNumber: string;

  @Field(() => String)
  @IsEmail({}, { message: 'El correo electrónico no tiene un formato válido' })
  @IsNotEmpty()
  email: string;

  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/, {
    message: 'La contraseña debe contener mayúsculas, minúsculas, números y un carácter especial',
  })
  password: string;

  @Field(() => String, { description: 'ID del complejo al que se asigna el guardia' })
  @IsUUID('4')
  @IsNotEmpty()
  complexId: string;

  @Field(() => String, { nullable: true, description: 'Turno asignado (MAÑANA, TARDE, NOCHE)' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  shift?: string;
}

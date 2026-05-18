import { InputType, Field } from '@nestjs/graphql';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';

@InputType({ description: 'Datos para el auto-registro de un supervisor en la plataforma' })
export class RegisterSupervisorInput {

  @Field(() => String, { description: 'Nombre completo del supervisor' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre completo es obligatorio' })
  @MaxLength(100)
  fullName: string;

  @Field(() => String, { description: 'Correo electrónico' })
  @IsEmail({}, { message: 'El correo electrónico no tiene un formato válido' })
  @IsNotEmpty()
  email: string;

  @Field(() => String, { description: 'Contraseña (mínimo 8 caracteres)' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'La contraseña debe tener mínimo 8 caracteres' })
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'La contraseña debe contener al menos una mayúscula, una minúscula y un número',
  })
  password: string;

  @Field(() => String, { description: 'Número de teléfono celular colombiano (ej: 3001234567)' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^3\d{9}$/, { message: 'Número de celular colombiano inválido (ej: 3001234567)' })
  phone: string;

  @Field(() => String, { description: 'Número de documento de identidad' })
  @IsString()
  @IsNotEmpty({ message: 'El número de documento es obligatorio' })
  @MaxLength(20)
  documentNumber: string;
}

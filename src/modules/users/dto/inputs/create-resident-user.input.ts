import { InputType, Field } from '@nestjs/graphql';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

@InputType({ description: 'Datos para registrar un residente en el sistema' })
export class CreateResidentUserInput {
  @Field(() => String, { description: 'Nombre(s) del residente' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MaxLength(100)
  name: string; 

  @Field(() => String, { description: 'Apellido(s) del residente' })
  @IsString()
  @IsNotEmpty({ message: 'El apellido es obligatorio' })
  @MaxLength(100)
  lastName: string;

  @Field(() => String, { description: 'Número de celular (solo Colombia, ej: 3001234567)' })
  @IsString()
  @IsNotEmpty({ message: 'El número de celular es obligatorio' })
  @Matches(/^3\d{9}$/, { message: 'Número de celular colombiano inválido (ej: 3001234567)' })
  phoneNumber: string;

  @Field(() => String, { description: 'Número de documento de identidad' })
  @IsString()
  @IsNotEmpty({ message: 'El número de identificación es obligatorio' })
  @MaxLength(20)
  identityNumber: string;

  @Field(() => String, { nullable: true, description: 'Correo electrónico (opcional)' })
  @IsEmail({}, { message: 'El correo electrónico no tiene un formato válido' })
  @IsOptional()
  email?: string;

  @Field(() => String, { description: 'ID de la unidad (apartamento) asignada' })
  @IsUUID('4', { message: 'El ID de unidad debe ser un UUID válido' })
  @IsNotEmpty()
  unitId: string;

  @Field(() => String, { description: 'ID del complejo residencial' })
  @IsUUID('4', { message: 'El ID del complejo debe ser un UUID válido' })
  @IsNotEmpty()
  complexId: string;
}

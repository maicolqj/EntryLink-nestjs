import { InputType, Field } from '@nestjs/graphql';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ValidRoles } from '../../../roles/enums/valid-roles';

/** Roles que se pueden crear con este DTO */
const ALLOWED_ROLES = [
  ValidRoles.COMPILANCE_OFFICER_ROL,
  ValidRoles.COMPLEX_ROL,
  ValidRoles.ACCOUNTANT_ROL,
  ValidRoles.SUPERVISOR_ROL,
];

@InputType({ description: 'Datos para crear un usuario administrativo (no residente)' })
export class CreateAdminUserInput {
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
  @IsEmail({}, { message: 'El correo electrónico no tiene un formato válido' })
  @IsNotEmpty()
  email: string;

  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'La contraseña debe tener mínimo 8 caracteres' })
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/, {
    message: 'La contraseña debe contener mayúsculas, minúsculas, números y un carácter especial',
  })
  password: string;

  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @Matches(/^3\d{9}$/, { message: 'Número de celular colombiano inválido (ej: 3001234567)' })
  phoneNumber: string;

  @Field(() => String, { nullable: true })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  identity?: string;

  @Field(() => ValidRoles, {
    description: `Rol a asignar. Permitidos: ${ALLOWED_ROLES.join(', ')}`,
  })
  @IsEnum(ValidRoles)
  role: ValidRoles;

  /**
   * Requerido cuando el rol es COMPLEX_ROL o SECURITY_ROL.
   * Asocia al usuario con el complejo que administra.
   */
  @Field(() => String, { nullable: true })
  @IsString()
  @IsOptional()
  complexId?: string;
}

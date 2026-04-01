import { InputType, Field } from '@nestjs/graphql';
import { IsEmail, IsNotEmpty, IsString, MinLength, MaxLength, IsBoolean, IsOptional } from 'class-validator';
import { ValidRoles } from '../../../roles/enums/valid-roles';

/**
 * Roles que pueden autenticarse con email + contraseña desde la tabla users.
 * COMPLEX_ROL se resuelve desde residential_complexes, no desde aquí.
 */
export const EMAIL_PASSWORD_USER_ROLES = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPILANCE_OFFICER_ROL,
  ValidRoles.ACCOUNTANT_ROL,
  ValidRoles.SUPERVISOR_ROL,
] as const;

@InputType({ description: 'Credenciales para inicio de sesión con email y contraseña' })
export class LoginEmailInput {
  @Field(() => String, { description: 'Correo electrónico' })
  @IsEmail({}, { message: 'El correo electrónico no tiene un formato válido' })
  @IsNotEmpty({ message: 'El correo electrónico es obligatorio' })
  email: string;

  @Field(() => String, { description: 'Contraseña' })
  @IsString()
  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  @MinLength(8, { message: 'La contraseña debe tener mínimo 8 caracteres' })
  @MaxLength(128, { message: 'La contraseña no puede superar 128 caracteres' })
  password: string;

  @Field(() => Boolean, { nullable: true, description: 'Mantener sesión activa por más tiempo' })
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}

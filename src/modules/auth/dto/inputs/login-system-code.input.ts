import { InputType, Field } from '@nestjs/graphql';
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { ValidRoles } from '../../../roles/enums/valid-roles';

/** Roles que pueden autenticarse con email + código de sistema */
export const SYSTEM_CODE_ROLES = [
  ValidRoles.SUPERVISOR_ROL,
  ValidRoles.SECURITY_ROL,
  ValidRoles.RESIDENT_ROL,
] as const;

@InputType({ description: 'Credenciales para inicio de sesión con email y código de sistema' })
export class LoginSystemCodeInput {
  @Field(() => String, { description: 'Correo electrónico del usuario' })
  @IsString({ message: 'El número de identificación es requerido' })
  @IsNotEmpty()
  identity: string;

  @Field(() => String, { description: 'Contraseña' })
  @IsString()
  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  @MinLength(8, { message: 'La contraseña debe tener mínimo 8 caracteres' })
  @MaxLength(128, { message: 'La contraseña no puede superar 128 caracteres' })
  password: string;
}

import { InputType, Field } from '@nestjs/graphql';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
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
  @IsEmail({}, { message: 'El correo electrónico no tiene un formato válido' })
  @IsNotEmpty()
  email: string;

  @Field(() => String, { description: 'Código de sistema asignado al usuario' })
  @IsString()
  @IsNotEmpty({ message: 'El código de sistema es obligatorio' })
  systemCode: string;
}

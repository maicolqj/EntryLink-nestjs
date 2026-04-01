import { InputType, Field } from '@nestjs/graphql';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { ValidRoles } from '../../../roles/enums/valid-roles';

/** Roles que el administrador del complejo puede crear */
export const STAFF_ROLES = [
  ValidRoles.SECURITY_ROL,
  ValidRoles.ACCOUNTANT_ROL,
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

@InputType({ description: 'Datos para crear un miembro del personal del complejo (guardia o contador)' })
export class CreateStaffMemberInput {
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
  identity: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  identityNumber?: string;

  @Field(() => String)
  @IsEmail({}, { message: 'El correo electrónico no tiene un formato válido' })
  @IsNotEmpty()
  email: string;

  @Field(() => String, {nullable: true})
  @IsString()
  @IsOptional()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/, {
    message: 'La contraseña debe contener mayúsculas, minúsculas, números y un carácter especial',
  })
  password?: string;

  @Field(() => String, { description: 'ID del complejo al que se asigna el personal' })
  @IsUUID('4')
  @IsNotEmpty()
  complexId: string;

  @Field(() => ValidRoles, {
    description: 'Rol a asignar: SECURITY_ROL | ACCOUNTANT_ROL',
  })
  @IsEnum(ValidRoles)
  @IsNotEmpty()
  role: StaffRole;

  @Field(() => String, { nullable: true, description: 'Turno asignado (MAÑANA, TARDE, NOCHE)' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  shift?: string;
}

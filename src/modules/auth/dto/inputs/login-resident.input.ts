import { InputType, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { SYSTEM_CODE_REGEX } from '../../../users/utils/system-code.util';

const normalizeText = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const normalizeSystemCode = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

@InputType({ description: 'Credenciales para inicio de sesión de residentes (documento + código de sistema)' })
export class LoginResidentInput {
  @Field(() => String, { description: 'Número de documento de identidad del residente' })
  @Transform(normalizeText)
  @IsString()
  @IsNotEmpty({ message: 'El número de identidad es obligatorio' })
  @MaxLength(20)
  identity: string;

  // Normaliza (trim + mayúsculas) antes de validar el formato: el código es
  // case-insensitive y el service compara en mayúscula, así que la validación
  // debe aceptar lo mismo (ej. `res-k7p3m`, ` RES-K7P3M `) y no ser más estricta.
  @Field(() => String, { description: 'Código de sistema asignado al residente (formato RES-xxxxx)' })
  @Transform(normalizeSystemCode)
  @IsString()
  @IsNotEmpty({ message: 'El código de sistema es obligatorio' })
  @Matches(SYSTEM_CODE_REGEX, { message: 'El código de sistema no tiene un formato válido' })
  systemCode: string;
}

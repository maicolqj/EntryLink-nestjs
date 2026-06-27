import { InputType, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { SYSTEM_CODE_REGEX } from '../../../users/utils/system-code.util';

@InputType({ description: 'Credenciales para inicio de sesión de residentes (documento + código de sistema)' })
export class LoginResidentInput {
  @Field(() => String, { description: 'Número de documento de identidad del residente' })
  @IsString()
  @IsNotEmpty({ message: 'El número de identidad es obligatorio' })
  @MaxLength(20)
  identity: string;

  @Field(() => String, { description: 'Código de sistema asignado al residente (formato RES-xxxxx)' })
  @IsString()
  @IsNotEmpty({ message: 'El código de sistema es obligatorio' })
  @Matches(SYSTEM_CODE_REGEX, { message: 'El código de sistema no tiene un formato válido' })
  systemCode: string;
}

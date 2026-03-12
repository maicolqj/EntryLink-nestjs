import { InputType, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsString, Matches, Length } from 'class-validator';

@InputType({ description: 'Solicitud de OTP para residentes' })
export class RequestOtpInput {
  @Field(() => String, { description: 'Número de celular del residente (ej: 3001234567)' })
  @IsString()
  @IsNotEmpty({ message: 'El número de celular es obligatorio' })
  @Matches(/^3\d{9}$/, { message: 'El número de celular debe ser un número colombiano válido (ej: 3001234567)' })
  phoneNumber: string;
}

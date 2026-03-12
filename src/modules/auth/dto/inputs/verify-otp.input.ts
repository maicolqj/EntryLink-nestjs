import { InputType, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsString, Matches, Length } from 'class-validator';

@InputType({ description: 'Verificación de OTP para completar el login del residente' })
export class VerifyOtpInput {
  @Field(() => String, { description: 'Número de celular del residente' })
  @IsString()
  @IsNotEmpty({ message: 'El número de celular es obligatorio' })
  @Matches(/^3\d{9}$/, { message: 'Número de celular inválido' })
  phoneNumber: string;

  @Field(() => String, { description: 'Código OTP de 6 dígitos recibido por SMS' })
  @IsString()
  @IsNotEmpty({ message: 'El código OTP es obligatorio' })
  @Length(6, 6, { message: 'El código OTP debe tener exactamente 6 dígitos' })
  @Matches(/^\d{6}$/, { message: 'El código OTP solo puede contener dígitos' })
  code: string;
}

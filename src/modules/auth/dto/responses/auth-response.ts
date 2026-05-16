import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType({ description: 'Respuesta de autenticación exitosa con tokens JWT' })
export class AuthResponse {
  @Field(() => String, { description: 'Access token JWT (15 min de vigencia)' })
  accessToken: string;

  @Field(() => String, { description: 'Refresh token para renovar el access token' })
  refreshToken: string;

  @Field(() => Int, { description: 'Segundos hasta que expire el access token' })
  expiresIn: number;

  @Field(() => String, { description: 'ID de la sesión activa' })
  sessionId: string;
}

@ObjectType({ description: 'Respuesta de autenticación exitosa con tokens JWT' })
export class RegisterVerifySupResponse {
  @Field(() => Boolean, { description: 'Correo Verificado' })
  succes: boolean;
}



@ObjectType({ description: 'Respuesta al solicitar OTP' })
export class OtpRequestResponse {
  @Field(() => Boolean)
  success: boolean;

  @Field(() => String)
  message: string;

  /** Solo enviado en entorno no-producción para testing */
  @Field(() => String, { nullable: true })
  debugCode?: string;
}

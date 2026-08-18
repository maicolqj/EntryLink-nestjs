import { ObjectType, Field, Int } from '@nestjs/graphql';

/**
 * Estado del registro de un supervisor mientras espera la verificación.
 *
 * Deliberadamente no devuelve el correo ni ningún otro dato del usuario: la
 * consulta es pública y su único argumento es el id, así que todo lo que
 * exponga queda al alcance de quien logre adivinarlo. La app ya conoce el
 * correo — lo escribió — y aquí solo necesita saber cuándo seguir.
 */
@ObjectType({ description: 'Estado de verificación del correo de un supervisor recién registrado' })
export class SupervisorVerificationStatusResponse {
  @Field(() => Boolean, { description: 'True cuando el supervisor ya abrió el enlace y su cuenta quedó activa' })
  verified: boolean;

  @Field(() => Int, {
    description:
      'Segundos que faltan para poder reenviar. 0 = el botón de reenvío ya está habilitado. ' +
      'Lo decide el servidor: el cliente puede reiniciarse y perder su cuenta atrás.',
  })
  resendAvailableInSeconds: number;
}

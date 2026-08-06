import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { Public } from '../../shared/decorators/public.decorator';
import { NotificationsService } from '../services/notifications.service';
import { PanicDeliveredInput } from '../dto/inputs/panic-delivered.input';

/**
 * Confirmación de ENTREGA de una alerta de pánico.
 *
 * REST plano y no GraphQL a propósito: lo llama Kotlin con OkHttp mientras la
 * sirena ya suena, con la app posiblemente muerta. Una mutación GraphQL
 * obligaría a cargar el manifiesto de queries persistidas y una sesión válida
 * antes de poder avisar, justo en el peor momento posible.
 *
 * Responde 204 sin cuerpo: al cliente no le sirve nada de vuelta y cada byte
 * cuenta cuando el equipo está despertando de Doze.
 */
@Controller('panic')
export class PanicController {

  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * El dispositivo confirma que MOSTRÓ la alerta. Automático, no humano: es lo
   * que distingue "no llegó" de "llegó y nadie respondió", y por tanto lo que
   * decide si el escalamiento debe insistir por otros canales o subir a avisar
   * al supervisor.
   *
   * Autenticado por el token firmado que viajó en el payload FCM, no por sesión
   * — ver PanicAckTokenService.
   */
  @Post(':id/delivered')
  @Public()
  // Sin límite de tasa: el caso normal es que TODOS los equipos que recibieron
  // la alerta confirmen a la vez, y en una torre pueden ser decenas en el mismo
  // segundo. El límite global de 20/s descartaría confirmaciones legítimas. El
  // token firmado y la idempotencia son la protección real.
  @SkipThrottle()
  @HttpCode(HttpStatus.NO_CONTENT)
  async markDelivered(
    @Param('id', new ParseUUIDPipe()) panicAlertId: string,
    @Body() input: PanicDeliveredInput,
  ): Promise<void> {
    await this.notificationsService.markPanicDelivered(panicAlertId, input);
  }
}

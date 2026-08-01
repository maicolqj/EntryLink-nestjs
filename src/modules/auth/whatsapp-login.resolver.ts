import { Resolver, Mutation, Query, Args, Context, ID } from '@nestjs/graphql';
import { ConfigService } from '@nestjs/config';

import { WhatsAppLoginService } from './services/whatsapp-login.service';
import { WhatsAppLoginChallengeResponse } from './dto/responses/whatsapp-login-challenge.response';
import { WhatsAppLoginStatusResponse } from './dto/responses/whatsapp-login-status.response';
import { AuthResponse } from './dto/responses/auth-response';
import { buildDeviceInfo } from './utils/device-info.util';
import { Public } from '../shared/decorators/public.decorator';

/**
 * Login de residentes por mensaje entrante de WhatsApp ("reverse-OTP").
 *
 * Las tres operaciones son públicas: son justamente el camino para entrar
 * cuando el residente perdió el acceso. La seguridad la dan el vínculo
 * documento ↔ teléfono remitente, el fingerprint del dispositivo y la
 * vigencia de 2 minutos.
 */
@Resolver()
export class WhatsAppLoginResolver {
  constructor(
    private readonly whatsAppLoginService: WhatsAppLoginService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Mutation(() => WhatsAppLoginChallengeResponse, {
    name: 'requestWhatsAppLoginChallenge',
    description:
      'Genera un link wa.me con un código que el residente debe ENVIAR desde su WhatsApp. ' +
      'No consume mensajes de plantilla: los mensajes entrantes no tienen costo. ' +
      'Responde igual exista o no la identidad, para no revelar qué documentos están registrados.',
  })
  async requestWhatsAppLoginChallenge(
    @Args('identity', { type: () => String }) identity: string,
    @Context() context: any,
  ): Promise<WhatsAppLoginChallengeResponse> {
    return this.whatsAppLoginService.requestChallenge(identity, this.deviceInfo(context));
  }

  @Public()
  @Query(() => Boolean, {
    name: 'whatsAppLoginAvailable',
    description:
      'Indica si el canal de login por WhatsApp entrante está habilitado en el servidor. ' +
      'El cliente la consulta antes de ofrecer la opción, en vez de descubrirlo fallando ' +
      'con WA_LOGIN_NOT_CONFIGURED. No revela nada del residente: solo refleja la configuración.',
  })
  whatsAppLoginAvailable(): boolean {
    return this.whatsAppLoginService.isEnabled;
  }

  @Public()
  @Query(() => WhatsAppLoginStatusResponse, {
    name: 'whatsAppLoginChallengeStatus',
    description:
      'Consulta si ya llegó el mensaje del residente. El cliente hace polling hasta CONFIRMED. ' +
      'Solo responde al mismo dispositivo que pidió el challenge.',
  })
  async whatsAppLoginChallengeStatus(
    @Args('challengeId', { type: () => ID }) challengeId: string,
    @Context() context: any,
  ): Promise<WhatsAppLoginStatusResponse> {
    return this.whatsAppLoginService.getStatus(challengeId, this.deviceInfo(context));
  }

  @Public()
  @Mutation(() => AuthResponse, {
    name: 'redeemWhatsAppLoginChallenge',
    description:
      'Canjea un challenge CONFIRMED por los tokens de sesión. Un solo uso, ' +
      'y solo desde el dispositivo donde se inició el flujo.',
  })
  async redeemWhatsAppLoginChallenge(
    @Args('challengeId', { type: () => ID }) challengeId: string,
    @Context() context: any,
  ): Promise<AuthResponse> {
    return this.whatsAppLoginService.redeem(challengeId, this.deviceInfo(context));
  }

  private deviceInfo(context: any) {
    return buildDeviceInfo(context, this.configService.getOrThrow<string>('FINGERPRINT_SECRET'));
  }
}

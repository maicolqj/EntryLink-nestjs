import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';

import { CallLog } from '../../call-logs/entities/call-log.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { Auth } from '../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

import { VoiceCallsService } from '../services/voice-calls.service';
import { StartResidentIntercomCallInput } from '../dto/inputs/start-resident-call.input';
import { StartSecurityIntercomCallInput } from '../dto/inputs/start-security-call.input';
import { AnswerIntercomCallInput } from '../dto/inputs/answer-call.input';
import { IntercomSignalInput } from '../dto/inputs/intercom-signal.input';
import { UpdateIntercomSettingsInput } from '../dto/inputs/intercom-settings.input';
import { IntercomCallSession } from '../dto/responses/intercom-call-session.response';
import { IntercomAdoption } from '../dto/responses/intercom-adoption.response';

/** Las dos partes posibles de una llamada de citofonía. */
const CALL_PARTIES = [ValidRoles.SECURITY_ROL, ValidRoles.RESIDENT_ROL];

/**
 * Citofonía por internet.
 *
 * Flujo de una llamada:
 * 1. Quien llama: `startResidentIntercomCall` (portería elige al residente) o
 *    `startSecurityIntercomCall` (el residente elige la portería de
 *    `securityPosts`). Solo a quien se eligió le llega
 *    `intercom:call:incoming` por socket y un push data-only.
 * 2. Quien recibe: `answerIntercomCall` → a quien llama le llega
 *    `intercom:call:accepted` y arma la oferta WebRTC.
 * 3. Los dos: `sendIntercomSignal` con offer/answer/candidate; la otra parte
 *    los recibe en `intercom:signal`.
 * 4. Cualquiera: `endIntercomCall` (o `rejectIntercomCall` mientras suena) →
 *    `intercom:call:ended` a las dos partes. A los 30 s sin respuesta se cierra
 *    sola como perdida.
 */
@Resolver()
export class VoiceCallsResolver {
  constructor(private readonly voiceCalls: VoiceCallsService) {}

  @Mutation(() => IntercomCallSession, {
    name: 'startResidentIntercomCall',
    description: 'Portería llama por internet a un residente',
  })
  @Auth({ roles: [ValidRoles.SECURITY_ROL] })
  startResidentCall(
    @Args('input') input: StartResidentIntercomCallInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<IntercomCallSession> {
    return this.voiceCalls.startResidentCall(input, currentUser);
  }

  @Mutation(() => IntercomCallSession, {
    name: 'startSecurityIntercomCall',
    description: 'El residente llama por internet a la portería',
  })
  @Auth({ roles: [ValidRoles.RESIDENT_ROL] })
  startSecurityCall(
    @Args('input') input: StartSecurityIntercomCallInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<IntercomCallSession> {
    return this.voiceCalls.startSecurityCall(input, currentUser);
  }

  @Mutation(() => IntercomCallSession, { name: 'answerIntercomCall' })
  @Auth({ roles: CALL_PARTIES })
  answer(
    @Args('input') input: AnswerIntercomCallInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<IntercomCallSession> {
    return this.voiceCalls.answer(input, currentUser);
  }

  @Mutation(() => CallLog, { name: 'rejectIntercomCall' })
  @Auth({ roles: CALL_PARTIES })
  reject(
    @Args('callId') callId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<CallLog> {
    return this.voiceCalls.reject(callId, currentUser);
  }

  @Mutation(() => CallLog, { name: 'endIntercomCall' })
  @Auth({ roles: CALL_PARTIES })
  end(
    @Args('callId') callId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<CallLog> {
    return this.voiceCalls.end(callId, currentUser);
  }

  @Mutation(() => Boolean, {
    name: 'sendIntercomSignal',
    description: 'Pasa offer/answer/candidate WebRTC a la otra parte',
  })
  @Auth({ roles: CALL_PARTIES })
  sendSignal(
    @Args('input') input: IntercomSignalInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    return this.voiceCalls.relaySignal(input, currentUser);
  }

  @Query(() => IntercomCallSession, {
    name: 'currentIntercomCall',
    nullable: true,
    description:
      'Llamada sonando o en curso de quien pregunta (al abrir la app desde el push)',
  })
  @Auth({ roles: CALL_PARTIES })
  currentCall(
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<IntercomCallSession | null> {
    return this.voiceCalls.currentCall(currentUser);
  }

  @Query(() => IntercomAdoption, {
    name: 'intercomAdoption',
    description: 'Unidades que quedarían sin citofonía al pasar a INTERNET',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL] })
  adoption(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<IntercomAdoption> {
    return this.voiceCalls.adoption(complexId, currentUser);
  }

  @Mutation(() => ResidentialComplex, {
    name: 'updateComplexIntercomSettings',
    description: 'Citofonía del conjunto (SIM o INTERNET). Solo SUPER_ADMIN',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  updateSettings(
    @Args('input') input: UpdateIntercomSettingsInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<ResidentialComplex> {
    return this.voiceCalls.updateSettings(input, currentUser);
  }
}

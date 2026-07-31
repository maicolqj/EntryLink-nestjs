import { Resolver, Mutation, Query, Args, Context, ID } from '@nestjs/graphql';
import { ConfigService } from '@nestjs/config';

import { DeviceApprovalService } from './services/device-approval.service';
import { DeviceApprovalResponse } from './dto/responses/device-approval.response';
import { DeviceApprovalStatusResponse } from './dto/responses/device-approval-status.response';
import { PendingDeviceApproval } from './dto/responses/pending-device-approval.response';
import { AuthResponse } from './dto/responses/auth-response';
import { JwtAccessPayload } from './interfaces/jwt-payload.interface';
import { buildDeviceInfo } from './utils/device-info.util';
import { Public } from '../shared/decorators/public.decorator';
import { Auth } from '../shared/decorators/auth.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { ValidRoles } from '../roles/enums/valid-roles';

/**
 * Ingreso aprobado desde un dispositivo confiable, avisado por push.
 *
 * El flujo se reparte entre dos dispositivos y por eso entre dos niveles de
 * acceso: el que pide entrar usa las operaciones públicas (no tiene sesión
 * todavía), y el que aprueba usa las autenticadas.
 */
@Resolver()
export class DeviceApprovalResolver {
  constructor(
    private readonly deviceApprovalService: DeviceApprovalService,
    private readonly configService: ConfigService,
  ) {}

  // ── Dispositivo que pide entrar (sin sesión) ──────────────────────────────

  @Public()
  @Mutation(() => DeviceApprovalResponse, {
    name: 'requestDeviceApproval',
    description:
      'Pide autorización de ingreso y avisa por push a los dispositivos vinculados del residente. ' +
      'No consume mensajes de WhatsApp. Responde igual exista o no la identidad, ' +
      'y no revela cuántos dispositivos se notificaron.',
  })
  async requestDeviceApproval(
    @Args('identity', { type: () => String }) identity: string,
    @Context() context: any,
  ): Promise<DeviceApprovalResponse> {
    return this.deviceApprovalService.requestApproval(identity, this.deviceInfo(context));
  }

  @Public()
  @Query(() => DeviceApprovalStatusResponse, {
    name: 'deviceApprovalStatus',
    description:
      'Consulta si el residente ya aprobó. El cliente hace polling hasta APPROVED. ' +
      'Solo responde al mismo dispositivo que pidió la autorización.',
  })
  async deviceApprovalStatus(
    @Args('challengeId', { type: () => ID }) challengeId: string,
    @Context() context: any,
  ): Promise<DeviceApprovalStatusResponse> {
    return this.deviceApprovalService.getStatus(challengeId, this.deviceInfo(context));
  }

  @Public()
  @Mutation(() => AuthResponse, {
    name: 'redeemDeviceApproval',
    description:
      'Canjea una solicitud APPROVED por los tokens de sesión. Un solo uso, ' +
      'y solo desde el dispositivo donde se inició el flujo.',
  })
  async redeemDeviceApproval(
    @Args('challengeId', { type: () => ID }) challengeId: string,
    @Context() context: any,
  ): Promise<AuthResponse> {
    return this.deviceApprovalService.redeem(challengeId, this.deviceInfo(context));
  }

  // ── Dispositivo de confianza (con sesión) ─────────────────────────────────

  @Auth({ roles: [ValidRoles.RESIDENT_ROL] })
  @Query(() => [PendingDeviceApproval], {
    name: 'pendingDeviceApprovals',
    description:
      'Solicitudes de ingreso esperando respuesta. Sirve de respaldo cuando el push no llegó.',
  })
  async pendingDeviceApprovals(
    @CurrentUser() payload: JwtAccessPayload,
  ): Promise<PendingDeviceApproval[]> {
    return this.deviceApprovalService.listPending(payload.sub);
  }

  @Auth({ roles: [ValidRoles.RESIDENT_ROL] })
  @Mutation(() => Boolean, {
    name: 'approveDeviceApproval',
    description:
      'Autoriza el ingreso. Antes de llamarla, la interfaz DEBE hacer que el residente compare ' +
      'el código de esta pantalla con el del dispositivo que pide entrar.',
  })
  async approveDeviceApproval(
    @Args('approvalId', { type: () => ID }) approvalId: string,
    @CurrentUser() payload: JwtAccessPayload,
  ): Promise<boolean> {
    return this.deviceApprovalService.approve(approvalId, payload.sub, payload.sessionId);
  }

  @Auth({ roles: [ValidRoles.RESIDENT_ROL] })
  @Mutation(() => Boolean, {
    name: 'denyDeviceApproval',
    description: 'Rechaza el ingreso. Es terminal: el solicitante debe pedir una nueva autorización.',
  })
  async denyDeviceApproval(
    @Args('approvalId', { type: () => ID }) approvalId: string,
    @CurrentUser() payload: JwtAccessPayload,
  ): Promise<boolean> {
    return this.deviceApprovalService.deny(approvalId, payload.sub, payload.sessionId);
  }

  private deviceInfo(context: any) {
    return buildDeviceInfo(context, this.configService.getOrThrow<string>('FINGERPRINT_SECRET'));
  }
}

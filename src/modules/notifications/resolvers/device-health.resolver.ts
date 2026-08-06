import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';

import { Auth }             from '../../shared/decorators/auth.decorator';
import { CurrentUser }      from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { DeviceHealthService } from '../services/device-health.service';
import {
  PushHealthCheckResult,
  DevicePushHealthStatus,
} from '../dto/responses/device-push-health.response';

/**
 * Diagnóstico de entrega push del propio dispositivo.
 *
 * Todo se resuelve por el token FCM del equipo y el usuario autenticado: nadie
 * puede disparar pruebas ni leer el estado de un equipo ajeno.
 */
@Resolver()
export class DeviceHealthResolver {

  constructor(private readonly deviceHealthService: DeviceHealthService) {}

  /**
   * Dispara la prueba de humo. Es la única validación real del autostart, que no
   * tiene API de consulta: se manda un push idéntico a un pánico y se espera el
   * ACK del equipo.
   */
  @Mutation(() => PushHealthCheckResult, { name: 'runPushHealthCheck' })
  @Auth()
  async runPushHealthCheck(
    @Args('deviceToken') deviceToken: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PushHealthCheckResult> {
    const subscription = await this.deviceHealthService.findSubscriptionForUser(
      currentUser.sub, deviceToken,
    );
    const { sentAt } = await this.deviceHealthService.sendHealthCheck(subscription.id);
    // El healthId sale de la fila de salud, no del envío: el cliente lo usa para
    // consultar el resultado mientras espera el ACK.
    const health = await this.deviceHealthService.getHealth(subscription.id);
    return { healthId: health.id, sentAt };
  }

  /**
   * Estado actual. El wizard lo consulta en bucle tras disparar la prueba,
   * porque el ACK llega por fuera del proceso y no hay forma de esperarlo.
   */
  @Query(() => DevicePushHealthStatus, { name: 'devicePushHealth' })
  @Auth()
  async devicePushHealth(
    @Args('deviceToken') deviceToken: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<DevicePushHealthStatus> {
    const subscription = await this.deviceHealthService.findSubscriptionForUser(
      currentUser.sub, deviceToken,
    );
    const health = await this.deviceHealthService.getHealth(subscription.id);

    return {
      healthId:              health.id,
      isHealthy:             health.isHealthy,
      // Confirmado DESPUÉS del último envío: comparar las marcas evita dar por
      // buena una prueba anterior cuando la actual todavía no ha respondido.
      lastCheckAcknowledged: !!health.lastTestAckAt && !!health.lastTestSentAt
        && health.lastTestAckAt >= health.lastTestSentAt,
      lastTestSentAt:        health.lastTestSentAt,
      lastTestAckAt:         health.lastTestAckAt,
      consecutiveFailures:   health.consecutiveFailures,
      onboardingCompletedAt: health.onboardingCompletedAt,
    };
  }

  /**
   * La app reporta el estado de sus permisos. Ninguno es consultable desde el
   * servidor, así que esta es la única visibilidad que tendrá soporte sin
   * pedirle nada al usuario.
   */
  @Mutation(() => DevicePushHealthStatus, { name: 'reportDevicePermissions' })
  @Auth()
  async reportDevicePermissions(
    @Args('deviceToken') deviceToken: string,
    @CurrentUser() currentUser: JwtAccessPayload,
    @Args('hasNotificationPermission', { nullable: true }) hasNotificationPermission?: boolean,
    @Args('hasBatteryOptimizationDisabled', { nullable: true }) hasBatteryOptimizationDisabled?: boolean,
    @Args('hasFullScreenIntentPermission', { nullable: true }) hasFullScreenIntentPermission?: boolean,
    @Args('onboardingCompleted', { nullable: true }) onboardingCompleted?: boolean,
  ): Promise<DevicePushHealthStatus> {
    const subscription = await this.deviceHealthService.findSubscriptionForUser(
      currentUser.sub, deviceToken,
    );
    const health = await this.deviceHealthService.reportPermissions(subscription.id, {
      hasNotificationPermission,
      hasBatteryOptimizationDisabled,
      hasFullScreenIntentPermission,
      onboardingCompleted,
    });

    return {
      healthId:              health.id,
      isHealthy:             health.isHealthy,
      lastCheckAcknowledged: !!health.lastTestAckAt && !!health.lastTestSentAt
        && health.lastTestAckAt >= health.lastTestSentAt,
      lastTestSentAt:        health.lastTestSentAt,
      lastTestAckAt:         health.lastTestAckAt,
      consecutiveFailures:   health.consecutiveFailures,
      onboardingCompletedAt: health.onboardingCompletedAt,
    };
  }
}

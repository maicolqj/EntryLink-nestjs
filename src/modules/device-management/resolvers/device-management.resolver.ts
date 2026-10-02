import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';

import { Auth } from '../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { DeviceManagementService } from '../services/device-management.service';
import {
  CompleteEnterpriseSignupInput,
  DeviceEnrollmentQr,
  DeviceManagementStatus,
  EnterpriseSignup,
  ManagedDevice,
  ManagedDeviceCommandInput,
  StartEnterpriseSignupInput,
} from '../dto/device-management.dto';

/**
 * Equipos de portería en modo kiosco (Android Management API). Solo el
 * SUPER_ADMIN: la empresa de Google es una para toda la plataforma.
 */
@Resolver()
export class DeviceManagementResolver {
  constructor(private readonly service: DeviceManagementService) {}

  @Query(() => DeviceManagementStatus, { name: 'deviceManagementStatus' })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  status(): Promise<DeviceManagementStatus> {
    return this.service.status();
  }

  @Mutation(() => EnterpriseSignup, {
    name: 'startEnterpriseSignup',
    description: 'Paso 1: enlace de Google para vincular la cuenta de la empresa',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  startSignup(
    @Args('input') input: StartEnterpriseSignupInput,
  ): Promise<EnterpriseSignup> {
    return this.service.startSignup(input.callbackUrl);
  }

  @Mutation(() => DeviceManagementStatus, {
    name: 'completeEnterpriseSignup',
    description: 'Paso 2: crea la empresa con el token que devolvió Google y aplica la política de kiosco',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  completeSignup(
    @Args('input') input: CompleteEnterpriseSignupInput,
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<DeviceManagementStatus> {
    return this.service.completeSignup(input.signupUrlName, input.enterpriseToken, user.sub);
  }

  @Mutation(() => DeviceManagementStatus, {
    name: 'applyKioskPolicy',
    description: 'Vuelve a enviar a Google la política de kiosco de portería',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  applyPolicy(): Promise<DeviceManagementStatus> {
    return this.service.applyPolicy();
  }

  @Mutation(() => DeviceEnrollmentQr, {
    name: 'createDeviceEnrollmentQr',
    description: 'QR (vigente 24 h) para inscribir equipos de portería de un conjunto',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  createEnrollmentQr(
    @Args('complexId') complexId: string,
  ): Promise<DeviceEnrollmentQr> {
    return this.service.createEnrollmentQr(complexId);
  }

  @Query(() => [ManagedDevice], {
    name: 'managedDevices',
    description: 'Equipos inscritos; con complexId, solo los de ese conjunto',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  devices(
    @Args('complexId', { type: () => String, nullable: true }) complexId?: string | null,
  ): Promise<ManagedDevice[]> {
    return this.service.devices(complexId);
  }

  @Mutation(() => Boolean, {
    name: 'managedDeviceCommand',
    description: 'Reiniciar o bloquear la pantalla de un equipo',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  command(@Args('input') input: ManagedDeviceCommandInput): Promise<boolean> {
    return this.service.command(input.deviceName, input.command);
  }

  @Mutation(() => Boolean, {
    name: 'releaseManagedDevice',
    description: 'Retira el equipo: lo BORRA y lo deja de fábrica (sale del modo kiosco)',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  release(@Args('deviceName') deviceName: string): Promise<boolean> {
    return this.service.release(deviceName);
  }
}

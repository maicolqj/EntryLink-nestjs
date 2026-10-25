import {
  Args,
  Field,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from '@nestjs/graphql';

import { DeviceFaceTheme } from '../entities/device-face-theme.iot-entity';
import { DevicesService } from '../services/devices.service';
import { DeviceThemesService } from './device-themes.service';
import { Auth } from '../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

@ObjectType('DeviceFaceThemeView', {
  description: 'Tema del catálogo y si ESTA matera lo puede mostrar',
})
export class DeviceFaceThemeView extends DeviceFaceTheme {
  @Field(() => Boolean)
  available: boolean;

  @Field(() => String, {
    nullable: true,
    description:
      'needs_sd · needs_psram · not_installed · unknown_capabilities · motivo de la matera',
  })
  reason?: string;

  @Field(() => Boolean, { description: 'Es el que muestra ahora' })
  active: boolean;
}

@ObjectType('SetDeviceFaceThemeResult')
export class SetDeviceFaceThemeResult {
  @Field(() => String, {
    description: 'applied · rejected · pending (llegará al despertar)',
  })
  status: string;

  @Field(() => String)
  themeId: string;

  @Field(() => String, { description: 'Tema que muestra la matera ahora' })
  activeTheme: string;

  @Field(() => String, { nullable: true })
  reason?: string;
}

/**
 * Pantalla "Apariencia / Tema de la carita" de RemoteLink. El resultado del
 * cambio también llega por Socket.io (`device:theme`), útil cuando la
 * mutation responde `pending` (matera con batería, dormida).
 */
@Resolver()
export class DeviceThemesResolver {
  constructor(
    private readonly devices: DevicesService,
    private readonly themes: DeviceThemesService,
  ) {}

  @Query(() => [DeviceFaceThemeView], { name: 'availableThemesForDevice' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.RESIDENT_ROL,
    ],
  })
  async availableThemesForDevice(
    @Args('deviceId') deviceId: string,
    @CurrentUser() u: JwtAccessPayload,
  ) {
    return this.themes.availableThemesForDevice(
      await this.devices.device(deviceId, u),
    );
  }

  @Mutation(() => SetDeviceFaceThemeResult, { name: 'setDeviceFaceTheme' })
  @Auth({ roles: [ValidRoles.RESIDENT_ROL] })
  async setDeviceFaceTheme(
    @Args('deviceId') deviceId: string,
    @Args('themeId') themeId: string,
    @CurrentUser() u: JwtAccessPayload,
  ) {
    return this.themes.setDeviceFaceTheme(
      await this.devices.device(deviceId, u),
      themeId,
      u,
    );
  }

  @Mutation(() => Boolean, {
    name: 'refreshDeviceThemes',
    description:
      'Pide a la matera su informe de temas. true = ya; false = al despertar',
  })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.RESIDENT_ROL,
    ],
  })
  async refreshDeviceThemes(
    @Args('deviceId') deviceId: string,
    @CurrentUser() u: JwtAccessPayload,
  ) {
    return this.themes.pingThemes(await this.devices.device(deviceId, u));
  }
}

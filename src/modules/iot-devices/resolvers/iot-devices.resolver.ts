import { ForbiddenException } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';

import { Device } from '../entities/device.iot-entity';
import { DevicesService } from '../services/devices.service';
import { DeviceNotificationsService } from '../notifications/device-notifications.service';
import { PlantProfilesService } from '../plants/plant-profiles.service';
import {
  CreatedIotDeviceResponse,
  CreateIotDeviceInput,
  DeviceNotificationPrefInput,
  DeviceNotificationPrefView,
  DeviceNotificationTypeView,
  FactoryResetDeviceInput,
  PlanterReadingsPage,
  PlantProfileView,
  StartDeviceOtaInput,
  UpdateDeviceConfigInput,
} from '../dto/iot-devices.dto';
import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { Auth } from '../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

/**
 * Permisos con los roles existentes (decisión: no se toca ValidPermissions).
 *  - Residente: opera sobre SUS aparatos (el servicio comprueba que es el dueño).
 *  - COMPLEX_ROL: los de su conjunto (alta, código, reset, listado, avisos obligatorios).
 *  - SUPER_ADMIN_ROL: todo, y el único que lanza un OTA.
 * `deviceId` en los argumentos admite el uuid o el id público (NEXUS-7F3A9C).
 */
const ADMIN = [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL];
const RESIDENTE = [ValidRoles.RESIDENT_ROL];
const TODOS = [...ADMIN, ...RESIDENTE];

@Resolver(() => Device)
export class IotDevicesResolver {
  constructor(
    private readonly devices: DevicesService,
    private readonly notifications: DeviceNotificationsService,
    private readonly plants: PlantProfilesService,
  ) {}

  // ─────────────────────────── Aprovisionamiento ───────────────────────────

  @Mutation(() => CreatedIotDeviceResponse, { name: 'createIotDevice' })
  @Auth({ roles: ADMIN })
  createIotDevice(
    @Args('input') input: CreateIotDeviceInput,
    @CurrentUser() u: JwtAccessPayload,
  ) {
    return this.devices.createDevice(input.type, input.complexId, u);
  }

  @Mutation(() => Device, { name: 'regenerateDevicePairingCode' })
  @Auth({ roles: ADMIN })
  regenerateDevicePairingCode(
    @Args('deviceId') deviceId: string,
    @CurrentUser() u: JwtAccessPayload,
  ) {
    return this.devices.regeneratePairingCode(deviceId, u);
  }

  // ─────────────────────────── Vinculación y transferencia ───────────────────────────

  @Mutation(() => Device, { name: 'linkDeviceByCode' })
  @Auth({ roles: RESIDENTE })
  linkDeviceByCode(
    @Args('code') code: string,
    @CurrentUser() u: JwtAccessPayload,
  ) {
    return this.devices.linkDeviceByCode(code, u);
  }

  @Mutation(() => Device, { name: 'factoryResetDevice' })
  @Auth({ roles: TODOS })
  factoryResetDevice(
    @Args('input') input: FactoryResetDeviceInput,
    @CurrentUser() u: JwtAccessPayload,
  ) {
    return this.devices.factoryResetDevice(
      input.deviceId,
      u,
      input.wipeCalibration ?? false,
    );
  }

  // ─────────────────────────── Ajustes del dueño ───────────────────────────

  @Mutation(() => Device, { name: 'renameDevice' })
  @Auth({ roles: RESIDENTE })
  renameDevice(
    @Args('deviceId') deviceId: string,
    @Args('name') name: string,
    @CurrentUser() u: JwtAccessPayload,
  ) {
    return this.devices.renameDevice(deviceId, name, u);
  }

  @Mutation(() => Device, { name: 'updateDeviceConfig' })
  @Auth({ roles: RESIDENTE })
  updateDeviceConfig(
    @Args('input') input: UpdateDeviceConfigInput,
    @CurrentUser() u: JwtAccessPayload,
  ) {
    return this.devices.updateDeviceConfig(input.deviceId, input.config, u);
  }

  @Mutation(() => Device, { name: 'setDevicePlant' })
  @Auth({ roles: RESIDENTE })
  setDevicePlant(
    @Args('deviceId') deviceId: string,
    @Args('plantId') plantId: string,
    @CurrentUser() u: JwtAccessPayload,
  ) {
    return this.devices.setDevicePlant(deviceId, plantId, u);
  }

  @Mutation(() => Device, { name: 'clearDevicePlant' })
  @Auth({ roles: RESIDENTE })
  clearDevicePlant(
    @Args('deviceId') deviceId: string,
    @CurrentUser() u: JwtAccessPayload,
  ) {
    return this.devices.clearDevicePlant(deviceId, u);
  }

  @Mutation(() => Boolean, {
    name: 'identifyDevice',
    description: 'true = llegó ya; false = al despertar',
  })
  @Auth({ roles: TODOS })
  identifyDevice(
    @Args('deviceId') deviceId: string,
    @CurrentUser() u: JwtAccessPayload,
  ) {
    return this.devices.identifyDevice(deviceId, u);
  }

  @Mutation(() => Boolean, {
    name: 'startDeviceOta',
    description: 'true = llegó ya; false = al conectar',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  startDeviceOta(@Args('input') input: StartDeviceOtaInput) {
    return this.devices.startOta(
      input.deviceId,
      input.url,
      input.sha256,
      input.version,
    );
  }

  // ─────────────────────────── Consultas ───────────────────────────

  @Query(() => [Device], { name: 'myDevices' })
  @Auth({ roles: RESIDENTE })
  myDevices(@CurrentUser() u: JwtAccessPayload) {
    return this.devices.myDevices(u);
  }

  @Query(() => Device, { name: 'device' })
  @Auth({ roles: TODOS })
  device(
    @Args('deviceId') deviceId: string,
    @CurrentUser() u: JwtAccessPayload,
  ) {
    return this.devices.device(deviceId, u);
  }

  @Query(() => PlanterReadingsPage, { name: 'deviceReadings' })
  @Auth({ roles: TODOS })
  deviceReadings(
    @Args('deviceId') deviceId: string,
    @Args('from', { type: () => Date }) from: Date,
    @Args('to', { type: () => Date }) to: Date,
    @Args('pagination', { type: () => PaginationInput, nullable: true })
    pagination: PaginationInput | undefined,
    @CurrentUser() u: JwtAccessPayload,
  ) {
    return this.devices.deviceReadings(
      deviceId,
      from,
      to,
      pagination?.page ?? 1,
      pagination?.limit ?? 100,
      u,
    );
  }

  @Query(() => [Device], { name: 'devicesByComplex' })
  @Auth({ roles: ADMIN })
  devicesByComplex(
    @Args('complexId') complexId: string,
    @CurrentUser() u: JwtAccessPayload,
  ) {
    return this.devices.devicesByComplex(complexId, u);
  }

  @Query(() => [PlantProfileView], { name: 'plantCatalog' })
  @Auth({ roles: TODOS })
  plantCatalog() {
    return this.plants.list();
  }

  // ─────────────────────────── Avisos de EntryLink en el aparato ───────────────────────────

  @Query(() => [DeviceNotificationTypeView], {
    name: 'deviceNotificationTypes',
  })
  @Auth({ roles: TODOS })
  deviceNotificationTypes(
    @Args('complexId') complexId: string,
    @CurrentUser() u: JwtAccessPayload,
  ) {
    return this.notifications.listTypes(this.complejoPermitido(complexId, u));
  }

  @Query(() => [DeviceNotificationPrefView], {
    name: 'deviceNotificationPrefs',
  })
  @Auth({ roles: TODOS })
  async deviceNotificationPrefs(
    @Args('deviceId') deviceId: string,
    @CurrentUser() u: JwtAccessPayload,
  ) {
    const device = await this.devices.device(deviceId, u);
    return this.notifications.getPrefs(device.ownerId ?? u.sub, device);
  }

  @Mutation(() => [DeviceNotificationPrefView], {
    name: 'updateDeviceNotificationPrefs',
  })
  @Auth({ roles: RESIDENTE })
  async updateDeviceNotificationPrefs(
    @Args('deviceId') deviceId: string,
    @Args('prefs', { type: () => [DeviceNotificationPrefInput] })
    prefs: DeviceNotificationPrefInput[],
    @CurrentUser() u: JwtAccessPayload,
  ) {
    const device = await this.devices.device(deviceId, u);
    if (device.ownerId !== u.sub)
      throw new ForbiddenException(
        'Solo el dueño elige los avisos de su dispositivo',
      );
    return this.notifications.updatePrefs(u.sub, device, prefs);
  }

  @Mutation(() => [DeviceNotificationTypeView], {
    name: 'setComplexMandatoryDeviceNotifications',
  })
  @Auth({ roles: ADMIN })
  setComplexMandatoryDeviceNotifications(
    @Args('complexId') complexId: string,
    @Args('typeKeys', { type: () => [String] }) typeKeys: string[],
    @CurrentUser() u: JwtAccessPayload,
  ) {
    return this.notifications.setComplexMandatory(
      this.complejoPermitido(complexId, u, true),
      typeKeys,
    );
  }

  @Mutation(() => String, {
    name: 'sendTestDeviceNotification',
    description: 'now | queue',
  })
  @Auth({ roles: RESIDENTE })
  async sendTestDeviceNotification(
    @Args('deviceId') deviceId: string,
    @Args('typeKey') typeKey: string,
    @CurrentUser() u: JwtAccessPayload,
  ) {
    const device = await this.devices.device(deviceId, u);
    return this.notifications.sendTest(device, typeKey);
  }

  /** Cada quien solo ve/configura su conjunto; SUPER_ADMIN cualquiera. */
  private complejoPermitido(
    complexId: string,
    u: JwtAccessPayload,
    soloAdmin = false,
  ): string {
    const superAdmin = u.roles?.includes(ValidRoles.SUPER_ADMIN_ROL);
    const admin = u.roles?.includes(ValidRoles.COMPLEX_ROL);
    if (superAdmin || (u.complexId === complexId && (!soloAdmin || admin)))
      return complexId;
    throw new ForbiddenException('No tienes acceso a ese conjunto');
  }
}

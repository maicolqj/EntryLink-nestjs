import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';

import { CurrentDevice, DeviceKeyGuard } from '../guards/device-key.guard';
import { Device } from '../entities/device.iot-entity';
import {
  DevicesService,
  PairingCodeResponse,
} from '../services/devices.service';
import { DeviceIngressService } from '../services/device-ingress.service';

/**
 * REST que usan los APARATOS (CONTRATO_REAL.md §6). Con el prefijo global la
 * URL completa es /api/v1/iot/devices/... → en el firmware
 * BACKEND_URL = "https://api.alternaqj.com/api/v1".
 *
 * El cuerpo de la telemetría se recibe como objeto plano a propósito: el
 * ValidationPipe global (forbidNonWhitelisted) no valida objetos sin clase, y
 * así un campo nuevo del firmware no rompe la ingesta. Lo valida el mismo
 * parser que usa MQTT.
 */
@Controller('iot/devices')
@UseGuards(DeviceKeyGuard)
@SkipThrottle()
export class IotDevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly ingress: DeviceIngressService,
  ) {}

  /** Cola sin red y respaldo cuando MQTT no conecta. Mismo JSON que por MQTT. */
  @Post('telemetry')
  @HttpCode(200)
  async telemetry(
    @CurrentDevice() device: Device,
    @Body() body: Record<string, unknown>,
  ): Promise<{ ok: true }> {
    const r = await this.ingress.ingestTelemetry(device, body, 'rest');
    if (!r.ok) throw new BadRequestException(r.error);
    return { ok: true };
  }

  @Post('pairing-code')
  @HttpCode(200)
  pairingCode(@CurrentDevice() device: Device): Promise<PairingCodeResponse> {
    return this.devices.requestPairingCode(device);
  }

  @Get(':deviceId/status')
  status(@CurrentDevice() device: Device) {
    return this.devices.getStatus(device);
  }

  /** 200 con el perfil (mismo JSON que set_plant sin "cmd") · 204 sin planta. */
  @Get(':deviceId/plant')
  plant(
    @CurrentDevice() device: Device,
    @Res({ passthrough: true }) res: Response,
  ) {
    const plant = this.devices.getPlant(device);
    if (!plant) {
      res.status(204);
      return undefined;
    }
    return plant;
  }
}

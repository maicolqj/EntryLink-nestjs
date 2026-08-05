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
import { DeviceHealthService } from '../services/device-health.service';
import { HealthCheckAckInput } from '../dto/inputs/health-check-ack.input';

/**
 * Confirmación del push de prueba.
 *
 * Mismo diseño que el ACK de pánico y por el mismo motivo: lo llama el cliente
 * al recibir un mensaje data-only, posiblemente con la app cerrada y sin sesión
 * cargada, así que la autorización viaja firmada dentro del propio push.
 */
@Controller('devices')
export class DeviceHealthController {

  constructor(private readonly deviceHealthService: DeviceHealthService) {}

  @Post('health-check/:healthId/ack')
  @Public()
  @SkipThrottle()
  @HttpCode(HttpStatus.NO_CONTENT)
  async ack(
    @Param('healthId', new ParseUUIDPipe()) healthId: string,
    @Body() input: HealthCheckAckInput,
  ): Promise<void> {
    await this.deviceHealthService.confirmHealthCheck(healthId, input.token);
  }
}

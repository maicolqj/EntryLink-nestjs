import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Device } from '../entities/device.iot-entity';
import { DeviceFaceTheme } from '../entities/device-face-theme.iot-entity';
import { DeviceOutboxService } from '../services/device-outbox.service';
import { DevicePublisher } from '../mqtt/device-publisher';
import { DeviceAckWaiter } from './device-ack-waiter';
import { faceThemeAvailability } from './face-theme.availability';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';

/** Cuánto espera la mutation el ack de una matera conectada. */
export const SET_THEME_ACK_MS = 6000;

export interface FaceThemeView extends DeviceFaceTheme {
  available: boolean;
  reason?: string;
  active: boolean;
}

export interface SetFaceThemeResult {
  /** applied = la matera lo aplicó · rejected = dijo que no (reason) · pending = llegará al despertar */
  status: 'applied' | 'rejected' | 'pending';
  themeId: string;
  /** Tema que muestra la matera ahora (según su ack o el último conocido). */
  activeTheme: string;
  reason?: string;
}

/**
 * Temas de caras: qué puede mostrar cada matera y el cambio desde la app.
 * El resultado también llega por Socket.io (`device:theme`, desde el ack).
 */
@Injectable()
export class DeviceThemesService {
  constructor(
    @InjectRepository(DeviceFaceTheme)
    private readonly themes: Repository<DeviceFaceTheme>,
    private readonly outbox: DeviceOutboxService,
    private readonly publisher: DevicePublisher,
    private readonly acks: DeviceAckWaiter,
  ) {}

  /** Criterio 4: el catálogo activo, marcando qué puede mostrar esta matera. */
  async availableThemesForDevice(device: Device): Promise<FaceThemeView[]> {
    const catalogo = await this.themes.find({
      where: { activo: true },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
    return catalogo.map((t) => ({
      ...t,
      ...faceThemeAvailability(t, device.capabilities),
      active: t.id === (device.faceTheme || 'classic'),
    }));
  }

  async setDeviceFaceTheme(
    device: Device,
    themeId: string,
    u: JwtAccessPayload,
  ): Promise<SetFaceThemeResult> {
    if (device.ownerId !== u.sub)
      throw new ForbiddenException(
        'Solo el dueño cambia la apariencia de su matera',
      );
    const theme = await this.themes.findOne({
      where: { id: themeId, activo: true },
    });
    if (!theme) throw new NotFoundException(`El tema "${themeId}" no existe`);
    const disp = faceThemeAvailability(theme, device.capabilities);
    if (!disp.available) {
      throw new BadRequestException(
        `El tema "${theme.nombre}" no está disponible para tu matera (${disp.reason})`,
      );
    }

    const conectada = this.publisher.isConnected(device.deviceId);
    // Si está conectada se espera su respuesta; la espera se arma ANTES de publicar
    const espera = conectada
      ? this.acks.wait(device.deviceId, 'set_theme', SET_THEME_ACK_MS)
      : null;
    const salio = await this.outbox.sendCommand(device, 'set_theme', {
      themeId,
    });
    const ack = salio && espera !== null ? await espera : null;
    if (!ack)
      return {
        status: 'pending',
        themeId,
        activeTheme: device.faceTheme || 'classic',
      };

    const activo = typeof ack.theme === 'string' ? ack.theme : device.faceTheme;
    return ack.ok === true
      ? { status: 'applied', themeId, activeTheme: activo }
      : {
          status: 'rejected',
          themeId,
          activeTheme: activo,
          reason:
            typeof ack.reason === 'string'
              ? ack.reason
              : typeof ack.error === 'string'
                ? ack.error
                : 'rejected',
        };
  }

  /** Pide a la matera su informe de capacidades y temas (ack "themes"). */
  pingThemes(device: Device): Promise<boolean> {
    return this.outbox.sendCommand(device, 'ping_themes');
  }
}

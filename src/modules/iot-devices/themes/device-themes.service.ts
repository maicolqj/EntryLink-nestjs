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
/** Instalar descarga el paquete por HTTPS antes de responder. */
export const INSTALL_THEME_ACK_MS = 20000;

export interface FaceThemeView extends DeviceFaceTheme {
  available: boolean;
  installed: boolean;
  reason?: string;
  active: boolean;
}

export interface SetFaceThemeResult {
  /** applied = la matera lo aplicó · rejected = dijo que no (reason) · pending = llegará al despertar */
  status: 'applied' | 'rejected' | 'pending';
  themeId: string;
  /** Tema que muestra la matera ahora (según su ack o el último conocido). */
  activeTheme: string;
  /** true si hubo que descargarlo (install_theme). */
  installed?: boolean;
  reason?: string;
}

/**
 * Temas de caras: qué puede mostrar cada matera y el cambio desde la app.
 * Un tema PACKAGE que la matera no tiene se instala "como una actualización"
 * (install_theme: HTTPS + SHA-256) y se activa en el mismo paso. El
 * resultado también llega por Socket.io (`device:theme`).
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

    // Paquete que no tiene (o en una versión vieja): se descarga y se activa
    const instalar = theme.kind === 'PACKAGE' && !disp.installed;
    const cmd = instalar ? 'install_theme' : 'set_theme';
    const extra = instalar
      ? {
          themeId,
          url: theme.packageUrl,
          sha256: theme.sha256,
          version: theme.version,
          activate: true,
        }
      : { themeId };

    const conectada = this.publisher.isConnected(device.deviceId);
    // Si está conectada se espera su respuesta; la espera se arma ANTES de publicar
    const espera = conectada
      ? this.acks.wait(
          device.deviceId,
          cmd,
          instalar ? INSTALL_THEME_ACK_MS : SET_THEME_ACK_MS,
        )
      : null;
    const salio = await this.outbox.sendCommand(device, cmd, extra);
    const ack = salio && espera !== null ? await espera : null;
    if (!ack)
      return {
        status: 'pending',
        themeId,
        activeTheme: device.faceTheme || 'classic',
        installed: instalar,
      };

    const activo = typeof ack.theme === 'string' ? ack.theme : device.faceTheme;
    const motivo =
      typeof ack.reason === 'string'
        ? ack.reason
        : typeof ack.error === 'string'
          ? ack.error
          : 'rejected';
    // Instalado pero no activado (lo diría "reason") cuenta como rechazo
    return ack.ok === true && activo === themeId
      ? { status: 'applied', themeId, activeTheme: activo, installed: instalar }
      : {
          status: 'rejected',
          themeId,
          activeTheme: activo,
          installed: instalar,
          reason: motivo,
        };
  }

  /** Borra un paquete de la matera (si era el activo, vuelve a classic). */
  async removeDeviceFaceTheme(
    device: Device,
    themeId: string,
    u: JwtAccessPayload,
  ): Promise<boolean> {
    if (device.ownerId !== u.sub)
      throw new ForbiddenException(
        'Solo el dueño gestiona los temas de su matera',
      );
    if (themeId === 'classic' || themeId === 'minimal')
      throw new BadRequestException(
        'Ese tema viene con la matera y no se borra',
      );
    return this.outbox.sendCommand(device, 'remove_theme', { themeId });
  }

  /** Pide a la matera su informe de temas (ack "themes"). */
  pingThemes(device: Device): Promise<boolean> {
    return this.outbox.sendCommand(device, 'ping_themes');
  }
}

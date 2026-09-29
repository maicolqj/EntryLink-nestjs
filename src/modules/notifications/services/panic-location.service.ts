import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PanicAlert } from '../entities/panic-alert.entity';
import { Notification } from '../entities/notification.entity';
import { PanicAlertStatus } from '../enums/panic-alert-status.enum';
import { ReportPanicLocationInput } from '../dto/inputs/report-panic-location.input';
import { SocketService } from '../../../core/infrastructure/socket/socket.service';
import { SocketEvent } from '../../../core/infrastructure/socket/socket.events';
import { CustomError } from '../../shared/utils/errors.utils';
import { PanicErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

/**
 * Cuánto tiempo después del disparo se acepta una ubicación. Pasado este plazo
 * el incidente ya está en manos de quien acudió y seguir recibiendo posiciones
 * sería rastrear a la persona, que es justo lo que no se quiere.
 */
export const PANIC_LOCATION_WINDOW_MS = 10 * 60 * 1000;

const CLOSED_STATUSES = [
  PanicAlertStatus.RESOLVED,
  PanicAlertStatus.FALSE_ALARM,
];

/**
 * Dónde está quien activó el pánico.
 *
 * Si alguien lo activa en la piscina, los vecinos corren a su apartamento. La
 * ubicación se captura una sola vez por incidente —nada de seguimiento
 * continuo—, la reporta solo quien disparó la alarma y la ven solo quienes la
 * recibieron o el personal de ese conjunto.
 */
@Injectable()
export class PanicLocationService {
  private readonly logger = new Logger(PanicLocationService.name);

  constructor(
    @InjectRepository(PanicAlert)
    private readonly panicRepo: Repository<PanicAlert>,
    @InjectRepository(Notification)
    private readonly notifRepo: Repository<Notification>,
    private readonly socketService: SocketService,
  ) {}

  async report(
    input: ReportPanicLocationInput,
    currentUser: JwtAccessPayload,
  ): Promise<PanicAlert> {
    const alert = await this.findOrFail(input.panicAlertId);

    if (alert.triggeredByUserId !== currentUser.sub) {
      throw new CustomError({
        message: 'Solo quien activó la alerta puede reportar su ubicación',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: PanicErrorCode.PANIC_LOCATION_NOT_ALLOWED,
      });
    }

    const age = Date.now() - new Date(alert.createdAt).getTime();
    if (
      CLOSED_STATUSES.includes(alert.status) ||
      age > PANIC_LOCATION_WINDOW_MS
    ) {
      throw new CustomError({
        message: 'La alerta ya no recibe ubicación',
        statusCode: HttpStatus.CONFLICT,
        errorCode: PanicErrorCode.PANIC_LOCATION_WINDOW_CLOSED,
      });
    }

    // Una hora del equipo en el futuro no se cree: se toma la del servidor.
    const reported = input.capturedAt ? new Date(input.capturedAt) : null;
    const capturedAt =
      reported && reported.getTime() <= Date.now() ? reported : new Date();

    alert.latitude = input.latitude;
    alert.longitude = input.longitude;
    alert.accuracy = input.accuracy;
    alert.locationCapturedAt = capturedAt;
    const saved = await this.panicRepo.save(alert);

    this.socketService.emitToComplex(
      saved.complexId,
      SocketEvent.PANIC_ALERT_LOCATION,
      {
        alertId: saved.id,
        complexId: saved.complexId,
        latitude: Number(saved.latitude),
        longitude: Number(saved.longitude),
        accuracy: Number(saved.accuracy),
        capturedAt: capturedAt.toISOString(),
      },
    );
    this.logger.log(
      `Ubicación del pánico ${saved.id} (±${Math.round(input.accuracy)} m)`,
    );

    return saved;
  }

  /**
   * La alerta con su ubicación, para quien abre el modal desde el push y se
   * perdió el evento del socket.
   */
  async find(
    panicAlertId: string,
    currentUser: JwtAccessPayload,
  ): Promise<PanicAlert> {
    const alert = await this.findOrFail(panicAlertId);
    await this.assertCanSee(alert, currentUser);
    return alert;
  }

  /**
   * Ven la ubicación quien disparó la alerta, el personal del conjunto y los
   * residentes a los que les llegó. Un residente de otra torre, que no recibió
   * la alarma, no tiene por qué saber dónde está su vecino.
   */
  private async assertCanSee(
    alert: PanicAlert,
    user: JwtAccessPayload,
  ): Promise<void> {
    if (alert.triggeredByUserId === user.sub) return;
    if (user.roles?.includes(ValidRoles.SUPER_ADMIN_ROL)) return;

    // La cuenta del complejo inicia sesión con el id del complejo como `sub`.
    if (user.sub === alert.complexId) return;

    const isStaff = user.roles?.some(
      (role) => role !== ValidRoles.RESIDENT_ROL,
    );
    if (isStaff && user.complexId === alert.complexId) return;

    const received = await this.notifRepo.exists({
      where: { panicAlertId: alert.id, recipientUserId: user.sub },
    });
    if (received) return;

    throw new CustomError({
      message: 'No tienes acceso a esta alerta',
      statusCode: HttpStatus.FORBIDDEN,
      errorCode: PanicErrorCode.PANIC_LOCATION_NOT_ALLOWED,
    });
  }

  private async findOrFail(id: string): Promise<PanicAlert> {
    const alert = await this.panicRepo.findOne({ where: { id } });
    if (!alert) {
      throw new CustomError({
        message: 'La alerta de pánico no existe',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: PanicErrorCode.PANIC_ALERT_NOT_FOUND,
      });
    }
    return alert;
  }
}

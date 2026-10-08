import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { SecurityAppExit } from '../entities/security-app-exit.entity';
import { ReportAppStateInput } from '../dto/inputs/report-app-state.input';
import { FilterSecurityAppExitsInput } from '../dto/inputs/filter-security-app-exits.input';
import { PaginatedSecurityAppExitsResponse } from '../dto/responses/paginated-security-app-exits.response';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';
import { SocketService } from '../../../core/infrastructure/socket/socket.service';
import { SocketEvent } from '../../../core/infrastructure/socket/socket.events';
import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../shared/utils/errors.utils';
import { SecurityAppExitErrorCode } from '../../shared/constans/error-codes.constants';

/** Desfase de reloj tolerado entre el equipo y el servidor. */
const CLOCK_SKEW_MS = 60 * 1000;

/**
 * Hasta dónde se acepta un evento atrasado. La app guarda en cola lo que no
 * pudo enviar sin conexión; más de un día ya no es una cola, es un reloj mal
 * puesto.
 */
const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class SecurityAppExitsService {
  private readonly logger = new Logger(SecurityAppExitsService.name);

  constructor(
    @InjectRepository(SecurityAppExit)
    private readonly exitRepo: Repository<SecurityAppExit>,

    @InjectRepository(ResidentialComplex)
    private readonly complexRepo: Repository<ResidentialComplex>,

    private readonly complexService: ResidentialComplexService,
    private readonly notificationsService: NotificationsService,
    private readonly socketService: SocketService,
  ) {}

  // ================================================================
  // VIGILANTE: la app reporta el cambio de estado
  // ================================================================

  /**
   * El vigilante sacó la app a segundo plano.
   *
   * Idempotente: si ya hay una salida abierta se devuelve esa. La app puede
   * reintentar o mandar dos eventos seguidos sin duplicar el registro.
   */
  async reportBackground(
    input: ReportAppStateInput,
    currentUser: JwtAccessPayload,
  ): Promise<SecurityAppExit> {
    const complexId = this.requireComplexId(currentUser);
    const leftAt = this.resolveOccurredAt(input?.occurredAt);

    const open = await this.findOpen(currentUser.sub);
    if (open) return open;

    let saved: SecurityAppExit;
    try {
      saved = await this.exitRepo.save(
        this.exitRepo.create({ complexId, guardId: currentUser.sub, leftAt }),
      );
    } catch (err) {
      // Dos peticiones a la vez: el índice único parcial dejó entrar una sola.
      if ((err as { code?: string })?.code === '23505') {
        const winner = await this.findOpen(currentUser.sub);
        if (winner) return winner;
      }
      throw err;
    }

    this.emitUpdated(complexId);

    // Con 0 minutos se avisa ya; con margen lo hace el cron cuando se cumple.
    const complex = await this.complexRepo.findOne({
      where: { id: complexId },
      select: ['id', 'guardExitAlertEnabled', 'guardExitAlertMinutes'],
    });
    if (complex?.guardExitAlertEnabled && complex.guardExitAlertMinutes === 0) {
      await this.sendAlerts([saved.id]);
    }

    return saved;
  }

  /**
   * El vigilante volvió a la app. Cierra la salida abierta, si la hay.
   *
   * La app también lo llama al arrancar: si el sistema la mató estando en
   * segundo plano, el regreso llega como un arranque y no como un cambio de
   * estado.
   */
  async reportForeground(
    input: ReportAppStateInput,
    currentUser: JwtAccessPayload,
  ): Promise<SecurityAppExit | null> {
    const occurredAt = this.resolveOccurredAt(input?.occurredAt);

    const open = await this.findOpen(currentUser.sub);
    if (!open) return null;

    // Un evento en cola puede traer una hora anterior a la salida registrada.
    const returnedAt =
      occurredAt < open.leftAt ? new Date(open.leftAt) : occurredAt;

    open.returnedAt = returnedAt;
    open.durationSeconds = Math.floor(
      (returnedAt.getTime() - new Date(open.leftAt).getTime()) / 1000,
    );
    const saved = await this.exitRepo.save(open);

    this.emitUpdated(saved.complexId);
    return saved;
  }

  // ================================================================
  // ADMINISTRACIÓN: consulta
  // ================================================================

  async findByComplex(
    complexId: string,
    pagination: PaginationInput,
    filters: FilterSecurityAppExitsInput | undefined,
    currentUser: JwtAccessPayload,
  ): Promise<PaginatedSecurityAppExitsResponse> {
    await this.complexService.findById(complexId, currentUser);

    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const qb = this.exitRepo
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.guard', 'guard')
      .where('e.complexId = :complexId', { complexId });

    if (filters?.guardId) {
      qb.andWhere('e.guardId = :guardId', { guardId: filters.guardId });
    }
    if (filters?.from) {
      qb.andWhere('e.leftAt >= :from', { from: filters.from });
    }
    if (filters?.to) {
      qb.andWhere('e.leftAt <= :to', { to: filters.to });
    }
    if (filters?.onlyOpen) {
      qb.andWhere('e.returnedAt IS NULL');
    }

    qb.orderBy('e.leftAt', 'DESC').skip(skip).take(limit);

    const [items, totalItems] = await qb.getManyAndCount();
    const totalPages = Math.ceil(totalItems / limit);

    return {
      items,
      pagination: {
        currentPage: page,
        itemsPerPage: limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  // ================================================================
  // AVISO A LA ADMINISTRACIÓN
  // ================================================================

  /**
   * Marca y avisa las salidas indicadas. El UPDATE con `alert_sent_at IS NULL`
   * es el candado: si el cron y la mutación (o dos instancias) llegan a la vez,
   * solo uno se queda con cada fila y el aviso no sale doble.
   */
  async sendAlerts(exitIds: string[]): Promise<number> {
    if (!exitIds.length) return 0;

    const [claimed]: [{ id: string }[], number] =
      await this.exitRepo.manager.query(
        `UPDATE security_app_exits
            SET alert_sent_at = NOW()
          WHERE id = ANY($1::uuid[])
            AND alert_sent_at IS NULL
            AND returned_at IS NULL
        RETURNING id`,
        [exitIds],
      );
    if (!claimed?.length) return 0;

    const exits = await this.exitRepo.find({
      where: claimed.map(({ id }) => ({ id })),
      relations: ['guard'],
    });

    for (const exit of exits) {
      this.notifyAdministration(exit).catch((err: unknown) =>
        this.logger.warn(
          `No se pudo avisar la salida ${exit.id}: ${err instanceof Error ? err.message : 'error desconocido'}`,
        ),
      );
    }

    return exits.length;
  }

  /**
   * Las salidas abiertas que ya cumplieron el margen de su conjunto y no se han
   * avisado. Se ignoran las de hace más de un día: prender el aviso no debe
   * disparar uno por cada vigilante que dejó la app cerrada la semana pasada.
   */
  async findDueAlerts(): Promise<string[]> {
    const rows: { id: string }[] = await this.exitRepo.manager.query(
      `SELECT e.id
         FROM security_app_exits e
         JOIN residential_complexes c ON c.id = e.complex_id
        WHERE e.returned_at IS NULL
          AND e.alert_sent_at IS NULL
          AND c.guard_exit_alert_enabled = true
          AND e.left_at <= NOW() - make_interval(mins => c.guard_exit_alert_minutes)
          AND e.left_at > NOW() - INTERVAL '24 hours'`,
    );
    return rows.map(({ id }) => id);
  }

  private async notifyAdministration(exit: SecurityAppExit): Promise<void> {
    const guardName = exit.guard?.fullName?.trim() || 'Un vigilante';
    const minutesAway = Math.floor(
      (Date.now() - new Date(exit.leftAt).getTime()) / 60000,
    );
    const body =
      minutesAway < 1
        ? `${guardName} acaba de salir de la app de portería`
        : `${guardName} lleva ${minutesAway} min fuera de la app de portería`;

    // La cuenta del complejo no es un user: su id es el del complejo.
    await this.notificationsService.notify({
      complexId: exit.complexId,
      userIds: [exit.complexId],
      type: NotificationType.SECURITY_APP_EXIT,
      priority: NotificationPriority.HIGH,
      title: 'Vigilante fuera de la app',
      body,
      entityId: exit.id,
      entityType: 'SECURITY_APP_EXIT',
      createdByUserId: exit.guardId,
      isActionable: false,
      metadata: {
        complexId: exit.complexId,
        exitId: exit.id,
        guardId: exit.guardId,
        guardName,
        leftAt: new Date(exit.leftAt).toISOString(),
      },
    });
  }

  // ================================================================
  // AUXILIARES
  // ================================================================

  private findOpen(guardId: string): Promise<SecurityAppExit | null> {
    return this.exitRepo.findOne({
      where: { guardId, returnedAt: IsNull() },
    });
  }

  private requireComplexId(currentUser: JwtAccessPayload): string {
    if (!currentUser.complexId) {
      throw new CustomError({
        message: 'El vigilante no tiene un conjunto asignado',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: SecurityAppExitErrorCode.SECURITY_APP_EXIT_NO_COMPLEX,
      });
    }
    return currentUser.complexId;
  }

  /**
   * La hora del evento. La del equipo solo se acepta dentro de un margen: el
   * vigilante no puede correr su salida hacia atrás ni inventarla en el futuro
   * más allá de lo que justifica una cola sin conexión.
   */
  private resolveOccurredAt(occurredAt?: Date): Date {
    const now = new Date();
    if (!occurredAt) return now;

    const time = new Date(occurredAt).getTime();
    if (
      Number.isNaN(time) ||
      time > now.getTime() + CLOCK_SKEW_MS ||
      time < now.getTime() - MAX_EVENT_AGE_MS
    ) {
      throw new CustomError({
        message: 'La hora del evento no es válida',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: SecurityAppExitErrorCode.SECURITY_APP_EXIT_INVALID_TIME,
      });
    }

    return time > now.getTime() ? now : new Date(time);
  }

  private emitUpdated(complexId: string): void {
    this.socketService.emitToComplex(
      complexId,
      SocketEvent.SECURITY_APP_EXIT_UPDATED,
      { complexId },
    );
  }
}

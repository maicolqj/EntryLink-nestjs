import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PubSub } from 'graphql-subscriptions';

import { Notification }                  from '../entities/notification.entity';
import { NotificationType }              from '../enums/notification-type.enum';
import { NotificationPriority }          from '../enums/notification-priority.enum';
import { CreateNotificationPayload }     from '../dto/inputs/create-notification.input';
import { FilterNotificationsInput }      from '../dto/inputs/filter-notifications.input';
import { PaginatedNotificationsResponse } from '../dto/responses/paginated-notifications.response';
import { UnreadCountResponse }           from '../dto/responses/unread-count.response';

import { PaginationInput }  from '../../shared/dto/inputs/pagination.input';
import { CustomError }      from '../../shared/utils/errors.utils';
import { GeneralErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';

/** Evento GraphQL Subscription para notificaciones en tiempo real */
export const NOTIFICATION_ADDED = 'notificationAdded';

@Injectable()
export class NotificationsService {
  private readonly logger  = new Logger(NotificationsService.name);
  private readonly pubSub  = new PubSub();

  constructor(
    @InjectRepository(Notification)
    private readonly notifRepo: Repository<Notification>,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // CREACIÓN (llamado desde otros módulos)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Crea y persiste una notificación, luego la publica en PubSub
   * para entregarla en tiempo real a los suscriptores activos.
   *
   * Llamado por: PackagesService, VisitsService, ResidentsService, VehiclesService, etc.
   */
  async create(payload: CreateNotificationPayload): Promise<Notification> {
    const notification = this.notifRepo.create({
      type:            payload.type,
      title:           payload.title,
      body:            payload.body,
      complexId:       payload.complexId,
      recipientUserId: payload.recipientUserId,
      priority:        payload.priority ?? NotificationPriority.NORMAL,
      entityId:        payload.entityId,
      entityType:      payload.entityType,
      metadata:        payload.metadata,
      isRead:          false,
    });

    const saved = await this.notifRepo.save(notification);

    // Publicar en tiempo real
    await this.pubSub.publish(NOTIFICATION_ADDED, {
      notificationAdded: saved,
    });

    this.logger.debug(
      `Notificación [${saved.type}] creada para usuario ${saved.recipientUserId ?? 'broadcast'} en complejo ${saved.complexId}`,
    );

    return saved;
  }

  /**
   * Fan-out: crea la misma notificación para múltiples usuarios.
   * Útil para comunicados del complejo.
   */
  async createBulk(
    userIds: string[],
    payload: Omit<CreateNotificationPayload, 'recipientUserId'>,
  ): Promise<void> {
    const notifications = userIds.map(userId =>
      this.notifRepo.create({
        ...payload,
        priority:        payload.priority ?? NotificationPriority.NORMAL,
        recipientUserId: userId,
        isRead:          false,
      }),
    );

    const saved = await this.notifRepo.save(notifications);

    // Publicar cada una en tiempo real
    for (const n of saved) {
      await this.pubSub.publish(NOTIFICATION_ADDED, { notificationAdded: n });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MUTACIONES GRAPHQL
  // ─────────────────────────────────────────────────────────────────────────────

  /** Marca una notificación como leída */
  async markAsRead(
    notificationId: string,
    currentUser: JwtAccessPayload,
  ): Promise<Notification> {
    const notif = await this.findByIdOrFail(notificationId);
    this.assertRecipient(notif, currentUser);

    if (notif.isRead) return notif;

    notif.isRead = true;
    notif.readAt = new Date();
    return this.notifRepo.save(notif);
  }

  /** Marca todas las notificaciones no leídas del usuario como leídas */
  async markAllAsRead(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<number> {
    const result = await this.notifRepo
      .createQueryBuilder()
      .update(Notification)
      .set({ isRead: true, readAt: new Date() })
      .where('recipientUserId = :userId', { userId: currentUser.sub })
      .andWhere('complexId = :complexId', { complexId })
      .andWhere('isRead = false')
      .execute();

    return result.affected ?? 0;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // QUERIES GRAPHQL
  // ─────────────────────────────────────────────────────────────────────────────

  /** Lista las notificaciones del usuario con paginación y filtros */
  async findByUser(
    complexId: string,
    pagination: PaginationInput,
    filters: FilterNotificationsInput,
    currentUser: JwtAccessPayload,
  ): Promise<PaginatedNotificationsResponse> {
    const { page, limit } = pagination;

    const qb = this.notifRepo
      .createQueryBuilder('n')
      .where('n.recipientUserId = :userId', { userId: currentUser.sub })
      .andWhere('n.complexId = :complexId', { complexId });

    if (filters.type)     qb.andWhere('n.type = :type',         { type:     filters.type });
    if (filters.priority) qb.andWhere('n.priority = :priority', { priority: filters.priority });
    if (filters.isRead !== undefined) {
      qb.andWhere('n.isRead = :isRead', { isRead: filters.isRead });
    }

    qb.orderBy('n.createdAt', 'DESC');

    const totalItems = await qb.getCount();
    const items      = await qb.skip((page - 1) * limit).take(limit).getMany();
    const totalPages = Math.ceil(totalItems / limit);

    return {
      items,
      pagination: {
        currentPage:     page,
        itemsPerPage:    limit,
        totalItems,
        totalPages,
        hasNextPage:     page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  /** Número de notificaciones no leídas del usuario en el complejo */
  async getUnreadCount(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<UnreadCountResponse> {
    const count = await this.notifRepo.count({
      where: {
        recipientUserId: currentUser.sub,
        complexId,
        isRead: false,
      },
    });
    return { count };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PUBSUB — acceso desde el resolver
  // ─────────────────────────────────────────────────────────────────────────────

  /** Devuelve el iterador de suscripción filtrado por usuario y complejo */
  asyncIterator(userId: string, complexId: string) {
    const iterator = this.pubSub.asyncIterableIterator<{ notificationAdded: Notification }>(
      NOTIFICATION_ADDED,
    );

    // Retornamos un iterador que filtra eventos que no pertenecen al usuario/complejo
    return this.filterIterator(iterator, userId, complexId);
  }

  private async *filterIterator(
    iterator: AsyncIterable<{ notificationAdded: Notification }>,
    userId: string,
    complexId: string,
  ): AsyncGenerator<{ notificationAdded: Notification }> {
    for await (const event of iterator) {
      const n = event.notificationAdded;
      if (
        n.complexId === complexId &&
        (n.recipientUserId === userId || n.recipientUserId == null)
      ) {
        yield event;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  private async findByIdOrFail(id: string): Promise<Notification> {
    const notif = await this.notifRepo.findOne({ where: { id } });
    if (!notif) {
      throw new CustomError({
        message: 'Notificación no encontrada',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: GeneralErrorCode.NOT_FOUND,
      });
    }
    return notif;
  }

  /** Verifica que el usuario actual sea el destinatario de la notificación */
  private assertRecipient(notif: Notification, currentUser: JwtAccessPayload): void {
    if (notif.recipientUserId && notif.recipientUserId !== currentUser.sub) {
      throw new CustomError({
        message: 'No tienes acceso a esta notificación',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: GeneralErrorCode.FORBIDDEN,
      });
    }
  }
}

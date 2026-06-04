import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Between, In, IsNull, Repository } from 'typeorm';
import * as admin from 'firebase-admin';
import * as webpush from 'web-push';

import { Notification }                  from '../entities/notification.entity';
import { PushSubscription }              from '../entities/push-subscription.entity';
import { NotificationBatch }             from '../entities/notification-batch.entity';
import { NotificationType }              from '../enums/notification-type.enum';
import { NotificationPriority }          from '../enums/notification-priority.enum';
import { NotificationActionType }        from '../enums/notification-action-type.enum';
import { NotificationActionResult }      from '../enums/notification-action-result.enum';
import { PushPlatform }                  from '../enums/push-platform.enum';
import { CreateNotificationPayload }     from '../dto/inputs/create-notification.input';
import { FilterNotificationsInput }      from '../dto/inputs/filter-notifications.input';
import { SavePushSubscriptionInput }     from '../dto/inputs/save-push-subscription.input';
import { SaveMobileTokenInput }          from '../dto/inputs/save-mobile-token.input';
import { SendNotificationInput }         from '../dto/inputs/send-notification.input';
import { PaginatedNotificationsResponse } from '../dto/responses/paginated-notifications.response';
import { UnreadCountResponse }           from '../dto/responses/unread-count.response';
import { PushSubscriptionResult }             from '../dto/responses/push-subscription-result.response';
import { SendNotificationResult }             from '../dto/responses/send-notification.response';
import { SentNotification, SentNotificationPaginatedResult } from '../dto/responses/sent-notifications.response';
import { NotificationDetailResponse, NotificationUserInfo } from '../dto/responses/notification-detail.response';

import { PaginationInput }  from '../../shared/dto/inputs/pagination.input';
import { CustomError }      from '../../shared/utils/errors.utils';
import { GeneralErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';

import { User }     from '../../users/entities/user.entity';
import { UserRole } from '../../users/entities/user_has_roles.entity';
import { Role }     from '../../roles/entities/role.entity';
import { ResidentsService } from '../../residents/services/residents.service';
import { ValidRoles }       from '../../roles/enums/valid-roles';
import { TriggerPanicAlertResult } from '../dto/responses/trigger-panic-alert.response';
import { SocketService }    from '../../../core/infrastructure/socket/socket.service';
import { SocketEvent }      from '../../../core/infrastructure/socket/socket.events';

/** Parámetros para el método notify() llamado desde otros módulos */
export interface NotifyParams {
  complexId:        string;
  userIds:          string[];
  type:             NotificationType;
  priority:         NotificationPriority;
  title:            string;
  body:             string;
  entityId?:        string;
  entityType?:      string;
  metadata?:        Record<string, unknown>;
  /** ID del usuario que originó la notificación. */
  createdByUserId?: string;
  /** true si el destinatario debe tomar una acción (aprobar, rechazar, etc.). */
  isActionable?:    boolean;
  /** Tipo de acción esperada. */
  actionType?:      NotificationActionType;
  /** Etiqueta del botón de acción en el frontend. */
  actionLabel?:     string;
  /**
   * Si true, se crea UN solo registro en BD con recipientUserId = null.
   * El push delivery sigue siendo fan-out a todos los userIds.
   */
  isBroadcast?:     boolean;
  /** Roles destinatarios del broadcast (para trazabilidad). */
  targetRoles?:     string[];
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  /** Indica si firebase-admin fue inicializado correctamente */
  private fcmEnabled = false;
  /** Indica si web-push VAPID fue configurado correctamente */
  private webPushEnabled = false;

  constructor(
    @InjectRepository(Notification)
    private readonly notifRepo: Repository<Notification>,

    @InjectRepository(PushSubscription)
    private readonly pushSubRepo: Repository<PushSubscription>,

    @InjectRepository(NotificationBatch)
    private readonly batchRepo: Repository<NotificationBatch>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,

    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,

    private readonly configService: ConfigService,
    private readonly residentsService: ResidentsService,
    private readonly socketService: SocketService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────────────────────────

  onModuleInit() {
    this.initFirebase();
    this.initWebPush();
  }

  private initFirebase(): void {
    const projectId   = this.configService.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');
    const privateKey  = this.configService.get<string>('FIREBASE_PRIVATE_KEY');

    if (!projectId || !clientEmail || !privateKey) {
      this.logger.warn('Firebase no configurado — FCM deshabilitado. Define FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL y FIREBASE_PRIVATE_KEY.');
      return;
    }

    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey: privateKey.replace(/\\n/g, '\n'),
        }),
      });
    }

    this.fcmEnabled = true;
    this.logger.log('Firebase Admin SDK inicializado');
  }

  private initWebPush(): void {
    const subject    = this.configService.get<string>('VAPID_SUBJECT');
    const publicKey  = this.configService.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.configService.get<string>('VAPID_PRIVATE_KEY');

    if (!subject || !publicKey || !privateKey) {
      this.logger.warn('VAPID no configurado — Web Push deshabilitado. Define VAPID_SUBJECT, VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY.');
      return;
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);
    this.webPushEnabled = true;
    this.logger.log('Web Push VAPID configurado');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MÉTODO PRINCIPAL — llamado desde otros módulos
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Crea las filas en BD y despacha push notifications a todas las plataformas
   * activas de los destinatarios.
   *
   * Ejemplo de uso (fire-and-forget):
   *   this.notificationsService.notify({ ... }).catch(err =>
   *     this.logger.warn(`Error al notificar: ${err?.message}`)
   *   );
   */
  async notify(params: NotifyParams): Promise<Notification[]> {
    if (params.userIds.length === 0) return [];

    // 1. Persistir en base de datos
    const saved = await this.persistBulk(params);

    // 2. Obtener suscripciones activas de los destinatarios
    const subscriptions = await this.pushSubRepo.find({
      where: { userId: In(params.userIds), isActive: true },
    });

    const webSubs    = subscriptions.filter(s => s.platform === PushPlatform.WEB);
    const mobileSubs = subscriptions.filter(s => s.platform !== PushPlatform.WEB);

    // 3. Despachar en paralelo sin bloquear la respuesta
    await Promise.allSettled([
      this.dispatchWebPush(webSubs, params),
      this.dispatchFCM(mobileSubs, params),
    ]);

    return saved;
  }

  private async dispatchPushOnly(userIds: string[], params: NotifyParams): Promise<void> {
    if (userIds.length === 0) return;
    const subscriptions = await this.pushSubRepo.find({
      where: { userId: In(userIds), isActive: true },
    });
    const webSubs    = subscriptions.filter(s => s.platform === PushPlatform.WEB);
    const mobileSubs = subscriptions.filter(s => s.platform !== PushPlatform.WEB);
    await Promise.allSettled([
      this.dispatchWebPush(webSubs, params),
      this.dispatchFCM(mobileSubs, params),
    ]);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CREACIÓN (llamado desde otros módulos — API legacy)
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
      createdByUserId: payload.createdByUserId,
      isActionable:    payload.isActionable ?? false,
      actionType:      payload.actionType,
      actionLabel:     payload.actionLabel,
    });

    const saved = await this.notifRepo.save(notification);

    if (saved.recipientUserId) {
      this.socketService.emitToUser(saved.recipientUserId, SocketEvent.NOTIFICATION_NEW, saved);
    } else {
      this.socketService.emitToComplex(saved.complexId, SocketEvent.NOTIFICATION_NEW, saved);
    }

    this.logger.debug(
      `[Socket] Notificación emitida [${saved.type}] → usuario ${saved.recipientUserId ?? 'broadcast'} | complejo ${saved.complexId}`,
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
        isActionable:    payload.isActionable ?? false,
      }),
    );

    const saved = await this.notifRepo.save(notifications);

    for (const n of saved) {
      this.socketService.emitToUser(n.recipientUserId, SocketEvent.NOTIFICATION_NEW, n);
      this.logger.debug(
        `[Socket] Notificación emitida [${n.type}] → usuario ${n.recipientUserId} | complejo ${n.complexId}`,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MUTACIONES GRAPHQL
  // ─────────────────────────────────────────────────────────────────────────────

  /** Elimina una notificación con control de acceso por rol */
  async deleteNotification(
    notificationId: string,
    currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    const notif = await this.notifRepo.findOne({ where: { id: notificationId } });
    if (!notif) return true;

    const isSuperAdmin   = currentUser.roles.includes(ValidRoles.SUPER_ADMIN_ROL);
    const isComplexAdmin = currentUser.roles.some(r =>
      r === ValidRoles.COMPLEX_ROL || r === ValidRoles.SUPERVISOR_ROL,
    );

    if (isSuperAdmin) {
      // puede eliminar cualquier notificación
    } else if (isComplexAdmin) {
      if (notif.complexId !== currentUser.complexId) {
        throw new CustomError({
          message: 'No tienes permiso para eliminar esta notificación',
          statusCode: HttpStatus.FORBIDDEN,
          errorCode: GeneralErrorCode.FORBIDDEN,
        });
      }
    } else {
      if (notif.isBroadcast) {
        throw new CustomError({
          message: 'Las notificaciones de difusión no pueden eliminarse individualmente',
          statusCode: HttpStatus.FORBIDDEN,
          errorCode: GeneralErrorCode.FORBIDDEN,
        });
      }
      if (notif.recipientUserId !== currentUser.sub) {
        throw new CustomError({
          message: 'No tienes permiso para eliminar esta notificación',
          statusCode: HttpStatus.FORBIDDEN,
          errorCode: GeneralErrorCode.FORBIDDEN,
        });
      }
    }

    await this.notifRepo.delete(notificationId);
    return true;
  }

  /** Marca una notificación como leída */
  async markAsRead(
    notificationId: string,
    currentUser: JwtAccessPayload,
  ): Promise<Notification> {
    const notif = await this.findByIdOrFail(notificationId);
    this.assertRecipient(notif, currentUser);

    // Los broadcasts son registros compartidos; el estado de lectura no aplica individualmente
    if (notif.isBroadcast) return notif;

    if (notif.isRead) return notif;

    notif.isRead = true;
    notif.readAt = new Date();
    return this.notifRepo.save(notif);
  }

  /** Marca todas las notificaciones no leídas como leídas según el alcance del rol */
  async markAllAsRead(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<number> {
    const isSuperAdmin   = currentUser.roles.includes(ValidRoles.SUPER_ADMIN_ROL);
    const isComplexAdmin = currentUser.roles.some(r =>
      r === ValidRoles.COMPLEX_ROL || r === ValidRoles.SUPERVISOR_ROL,
    );

    const qb = this.notifRepo
      .createQueryBuilder()
      .update(Notification)
      .set({ isRead: true, readAt: new Date() })
      .where('complexId = :complexId', { complexId })
      .andWhere('isRead = false');

    if (!isSuperAdmin && !isComplexAdmin) {
      qb.andWhere('recipientUserId = :userId', { userId: currentUser.sub });
    }

    const result = await qb.execute();
    return result.affected ?? 0;
  }

  /** Envía una notificación masiva (solo roles administradores) */
  async sendNotification(
    input: SendNotificationInput,
    currentUser: JwtAccessPayload,
  ): Promise<SendNotificationResult> {
    const targetRoles = input.targetRoles ?? [];

    const userIds = await this.resolveTargetUserIds(input.complexId, targetRoles, input.targetUnitId);

    if (userIds.length === 0) {
      throw new CustomError({
        message: 'No se encontraron destinatarios para la notificación',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    const type     = input.type     ?? NotificationType.SYSTEM_ANNOUNCEMENT;
    const priority = input.priority ?? NotificationPriority.NORMAL;

    // Para COMPLEX_ROL el sub del JWT es el ID del complejo (no un User),
    // por eso senderId queda null para evitar violar la FK a users.
    const senderId = currentUser.entityType === 'user' ? currentUser.sub : null;

    // Excluir al emisor de los destinatarios cuando es un usuario humano
    const filteredUserIds = senderId
      ? userIds.filter(id => id !== senderId)
      : userIds;

    const [created] = await Promise.all([
      this.notify({
        complexId:       input.complexId,
        userIds:         filteredUserIds,
        type,
        priority,
        title:           input.title,
        body:            input.body,
        metadata:        input.metadata,
        createdByUserId: senderId ?? undefined,
        isBroadcast:     false,
        targetRoles,
      }),
      this.batchRepo.save(
        this.batchRepo.create({
          senderId,
          complexId:       input.complexId,
          type,
          priority,
          title:           input.title,
          body:            input.body,
          targetRoles,
          recipientsCount: userIds.length,
        }),
      ),
    ]);

    const first = created[0];
    return {
      id:        first.id,
      title:     first.title,
      body:      first.body,
      createdAt: first.createdAt,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SUSCRIPCIONES PUSH
  // ─────────────────────────────────────────────────────────────────────────────

  /** Registra o actualiza una suscripción Web Push para el dashboard */
  async savePushSubscription(
    input: SavePushSubscriptionInput,
    currentUser: JwtAccessPayload,
  ): Promise<PushSubscriptionResult> {
    const existing = await this.pushSubRepo.findOne({
      where: {
        userId:   currentUser.sub,
        platform: PushPlatform.WEB,
        endpoint: input.endpoint,
      },
    });

    if (existing) {
      existing.p256dh   = input.p256dh;
      existing.auth     = input.auth;
      existing.isActive = true;
      await this.pushSubRepo.save(existing);
    } else {
      await this.pushSubRepo.save(
        this.pushSubRepo.create({
          userId:    currentUser.sub,
          complexId: input.complexId,
          platform:  PushPlatform.WEB,
          endpoint:  input.endpoint,
          p256dh:    input.p256dh,
          auth:      input.auth,
          isActive:  true,
        }),
      );
    }

    return { success: true };
  }

  /** Registra o activa un token FCM de dispositivo móvil */
  async saveMobileToken(
    input: SaveMobileTokenInput,
    currentUser: JwtAccessPayload,
  ): Promise<PushSubscriptionResult> {
    if (input.platform === PushPlatform.WEB) {
      throw new CustomError({
        message: 'Usa savePushSubscription para suscripciones web',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    const existing = await this.pushSubRepo.findOne({
      where: {
        userId:      currentUser.sub,
        platform:    input.platform,
        deviceToken: input.deviceToken,
      },
    });

    if (existing) {
      existing.isActive = true;
      await this.pushSubRepo.save(existing);
    } else {
      await this.pushSubRepo.save(
        this.pushSubRepo.create({
          userId:      currentUser.sub,
          complexId:   input.complexId,
          platform:    input.platform,
          deviceToken: input.deviceToken,
          isActive:    true,
        }),
      );
    }

    return { success: true };
  }

  /** Retorna la clave pública VAPID (pública, sin guard) */
  getVapidPublicKey(): string {
    const key = this.configService.get<string>('VAPID_PUBLIC_KEY');
    if (!key) {
      throw new CustomError({
        message: 'VAPID no configurado en este servidor',
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        errorCode: GeneralErrorCode.INTERNAL_SERVER_ERROR,
      });
    }
    return key;
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
      .where('n.complexId = :complexId', { complexId })
      .andWhere(
        '(n.recipientUserId = :userId OR n.isBroadcast = true)',
        { userId: currentUser.sub },
      );

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

  /** Lista todas las notificaciones del complejo (para admins/staff) con paginación y filtros */
  async findByComplex(
    complexId: string,
    pagination: PaginationInput,
    filters: FilterNotificationsInput,
  ): Promise<PaginatedNotificationsResponse> {
    const { page, limit } = pagination;

    const qb = this.notifRepo
      .createQueryBuilder('n')
      .where('n.complexId = :complexId', { complexId });

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

  /**
   * Devuelve el detalle completo de una notificación, incluyendo
   * información enriquecida del creador, destinatario y —si aplica—
   * del usuario que ejecutó la acción.
   *
   * Acceso:
   *  - El propio destinatario puede consultarla.
   *  - Roles admin/staff pueden consultar cualquier notificación del complejo.
   */
  async findOneDetail(
    notificationId: string,
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<NotificationDetailResponse> {
    const notif = await this.notifRepo.findOne({
      where: { id: notificationId, complexId },
    });

    if (!notif) {
      throw new CustomError({
        message: 'Notificación no encontrada',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: GeneralErrorCode.NOT_FOUND,
      });
    }

    // Solo el destinatario puede verla; admins/staff pueden ver cualquiera del complejo
    const isAdmin = currentUser.roles?.some(r =>
      [
        ValidRoles.SUPER_ADMIN_ROL,
        ValidRoles.COMPLEX_ROL,
        ValidRoles.SUPERVISOR_ROL,
        ValidRoles.COMPILANCE_OFFICER_ROL,
      ].includes(r as ValidRoles),
    );

    if (!isAdmin && notif.recipientUserId && notif.recipientUserId !== currentUser.sub) {
      throw new CustomError({
        message: 'No tienes acceso a esta notificación',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: GeneralErrorCode.FORBIDDEN,
      });
    }

    // ── Recopilar IDs de usuarios relevantes (sin nulls ni duplicados) ─────────
    // NOTA: recipientUserId puede ser complexId (no un usuario real) en notificaciones
    // enviadas al panel admin. Solo cargamos IDs que existan en la tabla users.
    const candidateIds = [...new Set(
      [notif.createdByUserId, notif.actionTakenByUserId, notif.recipientUserId]
        .filter((id): id is string => !!id),
    )];

    const userMap = new Map<string, NotificationUserInfo>();

    if (candidateIds.length > 0) {
      // getMany() con leftJoinAndSelect para que TypeORM resuelva el mapeo de
      // columnas (last_name, number_phone, etc.) sin depender de aliases en raw SQL.
      // No filtramos por deletedAt para mostrar datos históricos aunque el usuario
      // haya sido eliminado posteriormente.
      const users = await this.userRepo
        .createQueryBuilder('u')
        .leftJoinAndSelect('u.userRoles', 'ur')
        .leftJoinAndSelect('ur.role', 'r')
        .where('u.id IN (:...ids)', { ids: candidateIds })
        .getMany();

      for (const u of users) {
        const roles = (u.userRoles ?? [])
          .map(ur => ur.role?.name)
          .filter((name): name is ValidRoles => name != null)
          .map(name => name as string);

        userMap.set(u.id, {
          id:             u.id,
          name:           u.name,
          lastName:       u.lastName,
          fullName:       `${u.name} ${u.lastName}`.trim(),
          email:          u.email,
          phoneNumber:    u.phoneNumber,
          identity:       u.identity,
          profilePicture: u.profilePicture,
          roles,
        }); 
      }
    }

    const buildUserInfo = (userId?: string): NotificationUserInfo | undefined => {
      if (!userId) return undefined;
      return userMap.get(userId);
    };

    return {
      id:                  notif.id,
      type:                notif.type,
      priority:            notif.priority,
      title:               notif.title,
      body:                notif.body,
      metadata:            notif.metadata,
      isBroadcast:         notif.isBroadcast,
      targetRoles:         notif.targetRoles,
      isRead:              notif.isRead,
      readAt:              notif.readAt,
      recipientUserId:     notif.recipientUserId,
      recipientUser:       buildUserInfo(notif.recipientUserId),
      complexId:           notif.complexId,
      entityId:            notif.entityId,
      entityType:          notif.entityType,
      createdByUserId:     notif.createdByUserId,
      createdByUser:       buildUserInfo(notif.createdByUserId),
      isActionable:        notif.isActionable,
      actionType:          notif.actionType,
      actionLabel:         notif.actionLabel,
      actionTakenAt:       notif.actionTakenAt,
      actionTakenByUserId: notif.actionTakenByUserId,
      actionTakenByUser:   buildUserInfo(notif.actionTakenByUserId),
      actionResult:        notif.actionResult,
      createdAt:           notif.createdAt,
      updatedAt:           notif.updatedAt,
    };
  }

  /** Número de notificaciones no leídas en el complejo según el alcance del rol */
  async getUnreadCount(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<UnreadCountResponse> {
    const isSuperAdmin   = currentUser.roles.includes(ValidRoles.SUPER_ADMIN_ROL);
    const isComplexAdmin = currentUser.roles.some(r =>
      r === ValidRoles.COMPLEX_ROL || r === ValidRoles.SUPERVISOR_ROL,
    );

    const qb = this.notifRepo
      .createQueryBuilder('n')
      .where('n.complexId = :complexId', { complexId })
      .andWhere('n.isRead = false');

    if (!isSuperAdmin && !isComplexAdmin) {
      qb.andWhere(
        '(n.recipientUserId = :userId OR n.isBroadcast = true)',
        { userId: currentUser.sub },
      );
    }

    const count = await qb.getCount();
    return { count };
  }

  /** Historial paginado de envíos masivos realizados por el usuario en el complejo */
  async sentNotifications(
    complexId: string,
    pagination: PaginationInput,
    currentUser: JwtAccessPayload,
  ): Promise<SentNotificationPaginatedResult> {
    const { page, limit } = pagination;

    const [rows, totalItems] = await this.batchRepo.findAndCount({
      where:  { complexId },
      order:  { createdAt: 'DESC' },
      skip:   (page - 1) * limit,
      take:   limit,
    });

    const totalPages = Math.ceil(totalItems / limit);

    const items: SentNotification[] = rows.map(b => ({
      id:              b.id,
      type:            b.type,
      priority:        b.priority,
      title:           b.title,
      body:            b.body,
      recipientsCount: b.recipientsCount,
      targetRoles:     b.targetRoles,
      createdAt:       b.createdAt,
    }));

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

  // ─────────────────────────────────────────────────────────────────────────────
  // ALERTA DE PÁNICO
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Activa una alerta de pánico con routing automático según el rol del usuario:
   *  - SECURITY_ROL  → notifica a todos los residentes del complejo
   *  - RESIDENT_ROL  + buildingId → notifica al edificio + seguridad
   *  - RESIDENT_ROL  + sin edificio → notifica a todo el complejo + seguridad
   */
  async triggerPanicAlert(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<TriggerPanicAlertResult> {
    const isSecurity = currentUser.roles.includes(ValidRoles.SECURITY_ROL);
    const isResident = currentUser.roles.includes(ValidRoles.RESIDENT_ROL);
    const isStaff    = !isSecurity && !isResident; // COMPLEX_ROL, ACCOUNTANT_ROL, SUPERVISOR_ROL, COMPILANCE_OFFICER_ROL

    let triggerFullName: string | null = null;
    if (currentUser.entityType === 'user') {
      const triggeringUser = await this.userRepo.findOne({
        where:  { id: currentUser.sub },
        select: ['id', 'name', 'lastName'],
      });
      if (triggeringUser) triggerFullName = `${triggeringUser.name} ${triggeringUser.lastName}`.trim();
    }

    // ── Caso: staff del complejo (admin, supervisor, contador, compliance) ───
    if (isStaff) {
      const [residentIds, securityIds] = await Promise.all([
        this.resolveTargetUserIds(complexId, [ValidRoles.RESIDENT_ROL]),
        this.resolveTargetUserIds(complexId, [ValidRoles.SECURITY_ROL]),
      ]);

      const triggeredByLabel = triggerFullName
        ? `Administración – ${triggerFullName}`
        : 'Administración del complejo';
      const panicPayload = {
        complexId,
        type:            NotificationType.PANIC_ALERT,
        priority:        NotificationPriority.URGENT,
        title:           'Alerta de pánico — Personal del complejo',
        body:            `Alerta de pánico activada por ${triggeredByLabel}.`,
        isBroadcast:     true,
        createdByUserId: currentUser.sub,
        isActionable:    true,
        actionType:      NotificationActionType.ACKNOWLEDGE,
        actionLabel:     'Reconocer alerta',
        metadata:        { triggeredByLabel },
      };

      const allIds = [...residentIds, ...securityIds].filter(id => id !== currentUser.sub);
      if (allIds.length > 0) {
        await this.notify({
          ...panicPayload,
          userIds:     allIds,
          targetRoles: [ValidRoles.RESIDENT_ROL, ValidRoles.SECURITY_ROL],
        });
      }

      this.socketService.emitToComplex(complexId, SocketEvent.PANIC_ALERT_NEW, { complexId, triggeredBy: currentUser.sub, triggeredByLabel });
      this.logger.warn(`PANIC ALERT (staff) — complejo ${complexId}, activado por ${currentUser.sub}`);
      return { success: true };
    }

    // ── Caso: guardia de seguridad ──────────────────────────────────────────
    if (isSecurity) {
      const residentIds = await this.resolveTargetUserIds(complexId, [ValidRoles.RESIDENT_ROL]);

      const triggeredByLabel = triggerFullName ? `Guardia – ${triggerFullName}` : 'Guardia';
      const panicPayload = {
        complexId,
        type:            NotificationType.PANIC_ALERT,
        priority:        NotificationPriority.URGENT,
        title:           'Alerta de pánico — Seguridad',
        body:            `Alerta de pánico activada por ${triggeredByLabel}.`,
        isBroadcast:     true,
        targetRoles:     [ValidRoles.RESIDENT_ROL],
        createdByUserId: currentUser.sub,
        isActionable:    true,
        actionType:      NotificationActionType.ACKNOWLEDGE,
        actionLabel:     'Reconocer alerta',
        metadata:        { triggeredByLabel },
      };

      const allIds = [...residentIds.filter(id => id !== currentUser.sub), complexId];
      await this.notify({
        ...panicPayload,
        userIds:     allIds,
        targetRoles: [ValidRoles.RESIDENT_ROL, ValidRoles.COMPLEX_ROL],
      });

      this.socketService.emitToComplex(complexId, SocketEvent.PANIC_ALERT_NEW, { complexId, triggeredBy: currentUser.sub, triggeredByLabel });
      this.logger.warn(`PANIC ALERT (security) — complejo ${complexId}, activado por ${currentUser.sub}`);
      return { success: true };
    }

    // ── Casos 1 y 2: residente ──────────────────────────────────────────────
    const resident = await this.residentsService.findActiveResidentByUserIdInternal(
      currentUser.sub,
      complexId,
    );

    if (!resident) {
      throw new CustomError({
        message:    'No se encontró un residente activo para este usuario en el complejo',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode:  GeneralErrorCode.FORBIDDEN,
      });
    }

    const unit        = resident.unit!;
    const unitNumber  = unit.number;
    const title       = `Alerta de pánico — Unidad ${unitNumber}`;
    const securityIds = await this.resolveTargetUserIds(complexId, [ValidRoles.SECURITY_ROL]);

    let triggeredByLabel: string;

    if (unit.buildingId) {
      // ── Caso 1: edificio/torre ──────────────────────────────────────────
      const buildingName = unit.building?.name ?? unit.buildingId;
      triggeredByLabel   = `Residente – Unidad ${unitNumber}, ${buildingName}`;
      const buildingBody = `Alerta de pánico activada. ${triggeredByLabel}.`;
      const securityBody = `Alerta de pánico. ${triggeredByLabel}. Requiere atención inmediata.`;

      const buildingIds = (
        await this.residentsService.findActiveUserIdsByBuildingInternal(unit.buildingId)
      ).filter(id => id !== currentUser.sub);   // excluir al propio activador

      const residentPanicBase = {
        complexId,
        type:            NotificationType.PANIC_ALERT,
        priority:        NotificationPriority.URGENT,
        title,
        isBroadcast:     true,
        createdByUserId: currentUser.sub,
        isActionable:    true,
        actionType:      NotificationActionType.ACKNOWLEDGE,
        actionLabel:     'Reconocer alerta',
        metadata:        { triggeredByLabel },
      };

      const allIds = [...buildingIds, ...securityIds];
      if (allIds.length > 0) {
        await this.persistBulk({
          ...residentPanicBase,
          userIds:     allIds,
          body:        buildingBody,
          targetRoles: [ValidRoles.RESIDENT_ROL, ValidRoles.SECURITY_ROL],
        });
      }
      await Promise.allSettled([
        this.dispatchPushOnly(buildingIds, { ...residentPanicBase, userIds: buildingIds, body: buildingBody, targetRoles: [ValidRoles.RESIDENT_ROL] }),
        this.dispatchPushOnly(securityIds, { ...residentPanicBase, userIds: securityIds, body: securityBody, targetRoles: [ValidRoles.SECURITY_ROL] }),
      ]);
    } else {
      // ── Caso 2: casa individual ─────────────────────────────────────────
      triggeredByLabel   = `Residente – Unidad ${unitNumber}`;
      const complexBody  = `Alerta de pánico activada. ${triggeredByLabel}.`;
      const securityBody = `Alerta de pánico. ${triggeredByLabel}. Requiere atención inmediata.`;

      const residentIds = (
        await this.resolveTargetUserIds(complexId, [ValidRoles.RESIDENT_ROL])
      ).filter(id => id !== currentUser.sub);

      const residentPanicBase = {
        complexId,
        type:            NotificationType.PANIC_ALERT,
        priority:        NotificationPriority.URGENT,
        title,
        isBroadcast:     true,
        createdByUserId: currentUser.sub,
        isActionable:    true,
        actionType:      NotificationActionType.ACKNOWLEDGE,
        actionLabel:     'Reconocer alerta',
        metadata:        { triggeredByLabel },
      };

      const allIds = [...residentIds, ...securityIds];
      if (allIds.length > 0) {
        await this.persistBulk({
          ...residentPanicBase,
          userIds:     allIds,
          body:        complexBody,
          targetRoles: [ValidRoles.RESIDENT_ROL, ValidRoles.SECURITY_ROL],
        });
      }
      await Promise.allSettled([
        this.dispatchPushOnly(residentIds, { ...residentPanicBase, userIds: residentIds, body: complexBody,  targetRoles: [ValidRoles.RESIDENT_ROL] }),
        this.dispatchPushOnly(securityIds, { ...residentPanicBase, userIds: securityIds, body: securityBody, targetRoles: [ValidRoles.SECURITY_ROL] }),
      ]);
    }

    this.socketService.emitToComplex(complexId, SocketEvent.PANIC_ALERT_NEW, { complexId, unitId: unit.id, triggeredBy: currentUser.sub, triggeredByLabel });
    this.logger.warn(`PANIC ALERT (resident) — complejo ${complexId}, unidad ${unitNumber}, activado por ${currentUser.sub}`);
    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ACK DE ALARMA DE PÁNICO
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Retorna las alertas de pánico activas (sin ACK) del complejo.
   * El frontend las consulta al reconectar para mostrar solo alarmas pendientes.
   */
  async activePanicAlerts(complexId: string): Promise<Notification[]> {
    return this.notifRepo.find({
      where: {
        complexId,
        type:          NotificationType.PANIC_ALERT,
        actionTakenAt: IsNull(),
      },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Reconoce una alerta de pánico: persiste quién y cuándo atendió la alarma
   * y emite un evento para que todos los clientes conectados cierren el modal.
   */
  async acknowledgePanicAlert(
    notificationId: string,
    currentUser: JwtAccessPayload,
  ): Promise<Notification> {
    const notif = await this.findByIdOrFail(notificationId);

    if (notif.type !== NotificationType.PANIC_ALERT) {
      throw new CustomError({
        message:    'Solo se pueden reconocer alertas de pánico',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode:  GeneralErrorCode.FORBIDDEN,
      });
    }

    if (currentUser.complexId && notif.complexId !== currentUser.complexId) {
      throw new CustomError({
        message:    'No tienes acceso a esta alerta',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode:  GeneralErrorCode.FORBIDDEN,
      });
    }

    if (notif.actionTakenAt) {
      // Ya fue reconocida — retornar el estado actual sin error
      return notif;
    }

    const ackedAt = new Date();

    notif.actionTakenAt       = ackedAt;
    notif.actionTakenByUserId = currentUser.sub;
    notif.actionResult        = NotificationActionResult.ACKNOWLEDGED;

    const updated = await this.notifRepo.save(notif);

    // Mark all sibling notifications from the same panic event (±30s window)
    // so every recipient's record is cleared — one ACK closes the modal for everyone.
    const windowMs    = 30_000;
    const windowStart = new Date(notif.createdAt.getTime() - windowMs);
    const windowEnd   = new Date(notif.createdAt.getTime() + windowMs);
    await this.notifRepo.update(
      {
        complexId:     notif.complexId,
        type:          NotificationType.PANIC_ALERT,
        actionTakenAt: IsNull(),
        createdAt:     Between(windowStart, windowEnd),
      },
      {
        actionTakenAt:       ackedAt,
        actionTakenByUserId: currentUser.sub,
        actionResult:        NotificationActionResult.ACKNOWLEDGED,
      },
    );

    this.socketService.emitToComplex(notif.complexId, SocketEvent.PANIC_ALERT_ACKNOWLEDGED, updated);

    this.logger.log(
      `PANIC ALERT reconocida — id ${notificationId}, complejo ${notif.complexId}, por ${currentUser.sub}`,
    );

    return updated;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DESPACHO PUSH — FCM (Android + iOS)
  // ─────────────────────────────────────────────────────────────────────────────

  private async dispatchFCM(
    subs: PushSubscription[],
    params: NotifyParams,
  ): Promise<void> {
    if (!this.fcmEnabled || subs.length === 0) return;

    const tokens = subs.map(s => s.deviceToken).filter(Boolean) as string[];
    if (tokens.length === 0) return;

    const BATCH_SIZE = 500;
    const batches = chunk(tokens, BATCH_SIZE);

    for (const batch of batches) {
      const message: admin.messaging.MulticastMessage = {
        tokens: batch,
        notification: {
          title: params.title,
          body:  params.body,
        },
        data: {
          type:      params.type,
          priority:  params.priority,
          complexId: params.complexId,
          metadata:  JSON.stringify(params.metadata ?? {}),
          url:       '/dashboard/notificaciones',
        },
        android: {
          priority: params.priority === NotificationPriority.URGENT || params.priority === NotificationPriority.HIGH
            ? 'high'
            : 'normal',
          notification: {
            channelId: 'entrylink-default',
            priority:
              params.priority === NotificationPriority.URGENT ? 'max' :
              params.priority === NotificationPriority.HIGH   ? 'high' :
              'default',
            defaultVibrateTimings: true,
            sound: 'default',
          },
        },
        apns: {
          headers: {
            'apns-priority':
              params.priority === NotificationPriority.URGENT || params.priority === NotificationPriority.HIGH ? '10' : '5',
          },
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
              'content-available': 1,
            },
          },
        },
      };

      try {
        const response = await admin.messaging().sendEachForMulticast(message);

        const successCount = response.successCount;
        const failureCount = response.failureCount;
        this.logger.debug(
          `[FCM] Lote enviado [${params.type}] → ${successCount} exitosos, ${failureCount} fallidos | complejo ${params.complexId}`,
        );

        const invalidTokens: string[] = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const code = resp.error?.code;
            if (
              code === 'messaging/registration-token-not-registered' ||
              code === 'messaging/invalid-registration-token'
            ) {
              invalidTokens.push(batch[idx]);
            }
          }
        });

        if (invalidTokens.length > 0) {
          await this.pushSubRepo.update(
            { deviceToken: In(invalidTokens) },
            { isActive: false },
          );
          this.logger.debug(`Desactivados ${invalidTokens.length} tokens FCM inválidos`);
        }
      } catch (err: any) {
        this.logger.warn(`Error en despacho FCM: ${err?.message}`);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DESPACHO PUSH — Web Push (dashboard web)
  // ─────────────────────────────────────────────────────────────────────────────

  private async dispatchWebPush(
    subs: PushSubscription[],
    params: NotifyParams,
  ): Promise<void> {
    if (!this.webPushEnabled || subs.length === 0) return;

    await Promise.allSettled(
      subs.map(async (sub) => {
        if (!sub.endpoint || !sub.p256dh || !sub.auth) return;

        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            JSON.stringify({
              title:    params.title,
              body:     params.body,
              priority: params.priority,
              tag:      `entrylink-${params.type}`,
              data: {
                url:      '/dashboard/notificaciones',
                metadata: params.metadata,
              },
            }),
          );
          this.logger.debug(
            `[WebPush] Notificación enviada [${params.type}] → suscripción ${sub.id} | usuario ${sub.userId}`,
          );
        } catch (err: any) {
          // 410 Gone = suscripción expirada
          if (err?.statusCode === 410) {
            await this.pushSubRepo.update({ id: sub.id }, { isActive: false });
            this.logger.debug(`Suscripción web push expirada desactivada: ${sub.id}`);
          } else {
            this.logger.warn(`Error en web push a ${sub.endpoint}: ${err?.message}`);
          }
        }
      }),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HELPERS PRIVADOS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Persiste notificaciones y emite via Socket.io.
   * - isBroadcast = true → UN registro con recipientUserId = null
   * - isBroadcast = false (default) → fan-out: un registro por destinatario
   */
  private async persistBulk(params: NotifyParams): Promise<Notification[]> {
    let saved: Notification[];

    if (params.isBroadcast) {
      const entity = this.notifRepo.create({
        type:            params.type,
        priority:        params.priority,
        title:           params.title,
        body:            params.body,
        complexId:       params.complexId,
        recipientUserId: undefined,
        isBroadcast:     true,
        targetRoles:     params.targetRoles ?? [],
        entityId:        params.entityId,
        entityType:      params.entityType,
        metadata:        params.metadata,
        isRead:          false,
        createdByUserId: params.createdByUserId,
        isActionable:    params.isActionable ?? false,
        actionType:      params.actionType,
        actionLabel:     params.actionLabel,
      });
      saved = [await this.notifRepo.save(entity)];
      this.socketService.emitToComplex(params.complexId, SocketEvent.NOTIFICATION_NEW, saved[0]);
      this.logger.debug(
        `[Socket] broadcast [${params.type}] → ${params.userIds.length} destinatarios push | complejo ${params.complexId}`,
      );
    } else {
      const entities = params.userIds.map(userId =>
        this.notifRepo.create({
          type:            params.type,
          priority:        params.priority,
          title:           params.title,
          body:            params.body,
          complexId:       params.complexId,
          recipientUserId: userId,
          isBroadcast:     false,
          entityId:        params.entityId,
          entityType:      params.entityType,
          metadata:        params.metadata,
          isRead:          false,
          createdByUserId: params.createdByUserId,
          isActionable:    params.isActionable ?? false,
          actionType:      params.actionType,
          actionLabel:     params.actionLabel,
        }),
      );
      saved = await this.notifRepo.save(entities);
      for (const n of saved) {
        this.socketService.emitToUser(n.recipientUserId, SocketEvent.NOTIFICATION_NEW, n);
        this.logger.debug(
          `[Socket] Notificación emitida [${n.type}] → usuario ${n.recipientUserId} | complejo ${n.complexId}`,
        );
      }
      this.logger.debug(
        `[notify] ${saved.length} notificaciones creadas [${params.type}] en complejo ${params.complexId}`,
      );
    }

    return saved;
  }

  /**
   * Resuelve los IDs de usuario destinatarios según los roles y/o unidad solicitados.
   * Si targetRoles está vacío y no hay targetUnitId, retorna todos los usuarios activos del complejo.
   */
  private async resolveTargetUserIds(
    complexId: string,
    targetRoles: string[],
    targetUnitId?: string,
  ): Promise<string[]> {
    if (targetRoles.length === 0 && !targetUnitId) {
      const users = await this.userRepo.find({
        where: { complexId, deletedAt: undefined },
        select: ['id'],
      });
      return users.map(u => u.id);
    }

    const qb = this.userRoleRepo
      .createQueryBuilder('ur')
      .innerJoin('ur.user', 'u')
      .innerJoin('ur.role', 'r')
      .where('u.complex_id = :complexId', { complexId })
      .andWhere('u.deleted_at IS NULL')
      .select('u.id', 'userId')
      .distinct(true);

    if (targetRoles.length > 0) {
      qb.andWhere('r.name IN (:...roles)', { roles: targetRoles });
    }

    if (targetUnitId) {
      qb.innerJoin('residents', 'res', 'res.user_id = u.id AND res.unit_id = :unitId AND res.deleted_at IS NULL', { unitId: targetUnitId });
    }

    const userRoles = await qb.getRawMany<{ userId: string }>();

    return userRoles.map(row => row.userId);
  }

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

  private assertRecipient(notif: Notification, currentUser: JwtAccessPayload): void {
    const isSuperAdmin = currentUser.roles.includes(ValidRoles.SUPER_ADMIN_ROL);
    if (isSuperAdmin) return;

    const isComplexAdmin = currentUser.roles.some(r =>
      r === ValidRoles.COMPLEX_ROL || r === ValidRoles.SUPERVISOR_ROL,
    );

    if (isComplexAdmin) {
      if (notif.complexId !== currentUser.complexId) {
        throw new CustomError({
          message: 'No tienes acceso a esta notificación',
          statusCode: HttpStatus.FORBIDDEN,
          errorCode: GeneralErrorCode.FORBIDDEN,
        });
      }
      return;
    }

    if (notif.isBroadcast) {
      if (currentUser.complexId && notif.complexId !== currentUser.complexId) {
        throw new CustomError({
          message: 'No tienes acceso a esta notificación',
          statusCode: HttpStatus.FORBIDDEN,
          errorCode: GeneralErrorCode.FORBIDDEN,
        });
      }
      return;
    }

    if (notif.recipientUserId && notif.recipientUserId !== currentUser.sub) {
      throw new CustomError({
        message: 'No tienes acceso a esta notificación',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: GeneralErrorCode.FORBIDDEN,
      });
    }
  }
}

/** Divide un array en lotes de tamaño `size` */
function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

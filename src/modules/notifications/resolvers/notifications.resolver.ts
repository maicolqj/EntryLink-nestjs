import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';

import { Notification }                   from '../entities/notification.entity';
import { NotificationsService } from '../services/notifications.service';
import { FilterNotificationsInput }       from '../dto/inputs/filter-notifications.input';
import { SavePushSubscriptionInput }      from '../dto/inputs/save-push-subscription.input';
import { SaveMobileTokenInput }           from '../dto/inputs/save-mobile-token.input';
import { SendNotificationInput }          from '../dto/inputs/send-notification.input';
import { PaginatedNotificationsResponse } from '../dto/responses/paginated-notifications.response';
import { UnreadCountResponse }            from '../dto/responses/unread-count.response';
import { PushSubscriptionResult }              from '../dto/responses/push-subscription-result.response';
import { SendNotificationResult }              from '../dto/responses/send-notification.response';
import { SentNotificationPaginatedResult }     from '../dto/responses/sent-notifications.response';
import { TriggerPanicAlertResult }             from '../dto/responses/trigger-panic-alert.response';
import { RequestSecurityCallResult }           from '../dto/responses/request-security-call.response';
import { NotificationDetailResponse }          from '../dto/responses/notification-detail.response';
import { PaginationInput }                     from '../../shared/dto/inputs/pagination.input';

import { Auth }             from '../../shared/decorators/auth.decorator';
import { Public }           from '../../shared/decorators/public.decorator';
import { CurrentUser }      from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles }       from '../../roles/enums/valid-roles';

@Resolver(() => Notification)
export class NotificationsResolver {

  constructor(private readonly notificationsService: NotificationsService) {}

  // ================================================================
  // MUTATIONS
  // ================================================================

  /**
   * Marca una notificación como leída.
   */
  @Mutation(() => Notification, { name: 'markNotificationAsRead' })
  @Auth()
  markAsRead(
    @Args('notificationId') notificationId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Notification> {
    return this.notificationsService.markAsRead(notificationId, currentUser);
  }

  /**
   * Marca todas las notificaciones no leídas del usuario como leídas.
   * Devuelve el número de notificaciones actualizadas.
   */
  @Mutation(() => Int, { name: 'markAllNotificationsAsRead' })
  @Auth()
  markAllAsRead(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<number> {
    return this.notificationsService.markAllAsRead(complexId, currentUser);
  }

  /**
   * Envía una notificación masiva al complejo.
   * Solo disponible para administradores del complejo y supervisores.
   */
  @Mutation(() => SendNotificationResult, { name: 'sendNotification' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
    ],
  })
  sendNotification(
    @Args('input') input: SendNotificationInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<SendNotificationResult> {
    return this.notificationsService.sendNotification(input, currentUser);
  }

  /**
   * Registra o actualiza una suscripción Web Push para el dashboard web.
   */
  @Mutation(() => PushSubscriptionResult, { name: 'savePushSubscription' })
  @Auth()
  savePushSubscription(
    @Args('input') input: SavePushSubscriptionInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PushSubscriptionResult> {
    return this.notificationsService.savePushSubscription(input, currentUser);
  }

  /**
   * Activa una alerta de pánico. Disponible para cualquier rol con acceso al panel.
   * El routing de destinatarios se determina automáticamente según el rol del activador.
   */
  @Mutation(() => TriggerPanicAlertResult, { name: 'triggerPanicAlert' })
  @Auth({ roles: [
    ValidRoles.RESIDENT_ROL,
    ValidRoles.SECURITY_ROL,
    ValidRoles.COMPLEX_ROL,
    ValidRoles.ACCOUNTANT_ROL,
    ValidRoles.SUPERVISOR_ROL,
    ValidRoles.COMPILANCE_OFFICER_ROL,
  ] })
  triggerPanicAlert(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<TriggerPanicAlertResult> {
    return this.notificationsService.triggerPanicAlert(complexId, currentUser);
  }

  /**
   * Un residente solicita que portería (rol SECURITY) llame a su unidad.
   * Enruta automáticamente a los guardias del complejo del residente autenticado.
   */
  @Mutation(() => RequestSecurityCallResult, { name: 'requestSecurityCall' })
  @Auth({ roles: [ValidRoles.RESIDENT_ROL] })
  requestSecurityCall(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<RequestSecurityCallResult> {
    return this.notificationsService.requestSecurityCall(complexId, currentUser);
  }

  /**
   * Reconoce una alerta de pánico (botón "OK").
   * Persiste quién y cuándo atendió la alarma y emite un evento para que
   * todos los clientes conectados al complejo cierren el modal.
   */
  @Mutation(() => Notification, { name: 'acknowledgePanicAlert' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
      ValidRoles.SECURITY_ROL,
      ValidRoles.RESIDENT_ROL,
    ],
  })
  acknowledgePanicAlert(
    @Args('notificationId') notificationId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Notification> {
    return this.notificationsService.acknowledgePanicAlert(notificationId, currentUser);
  }

  /**
   * Elimina (soft-delete) una notificación de la lista del usuario autenticado.
   * Solo puede eliminar notificaciones donde es el destinatario directo.
   */
  @Mutation(() => Boolean, { name: 'deleteNotification' })
  @Auth()
  deleteNotification(
    @Args('notificationId') notificationId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    return this.notificationsService.deleteNotification(notificationId, currentUser);
  }

  /**
   * Registra o activa un token FCM de dispositivo móvil (Android / iOS).
   */
  @Mutation(() => PushSubscriptionResult, { name: 'saveMobileToken' })
  @Auth()
  saveMobileToken(
    @Args('input') input: SaveMobileTokenInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PushSubscriptionResult> {
    return this.notificationsService.saveMobileToken(input, currentUser);
  }

  // ================================================================
  // QUERIES
  // ================================================================

  /**
   * Lista las notificaciones del usuario autenticado con paginación y filtros.
   */
  @Query(() => PaginatedNotificationsResponse, { name: 'myNotifications' })
  @Auth()
  findByUser(
    @Args('complexId')                      complexId: string,
    @Args('pagination', { nullable: true }) pagination: PaginationInput = { page: 1, limit: 20 },
    @Args('filters',    { nullable: true }) filters: FilterNotificationsInput = {},
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PaginatedNotificationsResponse> {
    return this.notificationsService.findByUser(complexId, pagination, filters, currentUser);
  }

  /**
   * Lista todas las notificaciones del complejo (para admins/staff).
   * Útil para que el panel de administración vea comunicados enviados a residentes.
   */
  @Query(() => PaginatedNotificationsResponse, { name: 'complexNotifications' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
      ValidRoles.COMPILANCE_OFFICER_ROL,
    ],
  })
  findByComplex(
    @Args('complexId')                      complexId: string,
    @Args('pagination', { nullable: true }) pagination: PaginationInput = { page: 1, limit: 20 },
    @Args('filters',    { nullable: true }) filters: FilterNotificationsInput = {},
  ): Promise<PaginatedNotificationsResponse> {
    return this.notificationsService.findByComplex(complexId, pagination, filters);
  }

  /**
   * Devuelve el detalle completo de una notificación: contenido, metadatos,
   * información del creador (nombre, cargo/rol), datos del destinatario,
   * y — si la notificación es accionable — el tipo de acción, etiqueta,
   * resultado y quién la ejecutó.
   *
   * Acceso: el propio destinatario o roles admin/staff del complejo.
   */
  @Query(() => NotificationDetailResponse, { name: 'notificationDetail' })
  @Auth()
  notificationDetail(
    @Args('notificationId') notificationId: string,
    @Args('complexId')      complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<NotificationDetailResponse> {
    return this.notificationsService.findOneDetail(notificationId, complexId, currentUser);
  }

  /**
   * Número de notificaciones no leídas del usuario en el complejo.
   * Ideal para el badge del ícono de campana en la app.
   */
  @Query(() => UnreadCountResponse, { name: 'unreadNotificationsCount' })
  @Auth()
  getUnreadCount(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<UnreadCountResponse> {
    return this.notificationsService.getUnreadCount(complexId, currentUser);
  }

  /** 
   * Historial paginado de envíos masivos realizados por el usuario autenticado.
   * Solo disponible para administradores del complejo y supervisores.
   */
  @Query(() => SentNotificationPaginatedResult, { name: 'sentNotifications' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
    ],
  })
  sentNotifications(
    @Args('complexId')                      complexId: string,
    @Args('pagination', { nullable: true }) pagination: PaginationInput = { page: 1, limit: 20 },
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<SentNotificationPaginatedResult> {
    return this.notificationsService.sentNotifications(complexId, pagination, currentUser);
  }

  /**
   * Retorna la clave pública VAPID para configurar el Service Worker del dashboard.
   * No requiere autenticación.
   */
  @Public()
  @Query(() => String, { name: 'vapidPublicKey' })
  vapidPublicKey(): string {
    return this.notificationsService.getVapidPublicKey();
  }

  /**
   * Retorna las alertas de pánico activas (sin ACK) del complejo.
   * El frontend llama a este query al reconectar/montar para mostrar solo
   * alarmas pendientes y evitar el bucle de re-aparición.
   */
  @Query(() => [Notification], { name: 'activePanicAlerts' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
      ValidRoles.SECURITY_ROL,
      ValidRoles.RESIDENT_ROL,
    ],
  })
  activePanicAlerts(
    @Args('complexId') complexId: string,
  ): Promise<Notification[]> {
    return this.notificationsService.activePanicAlerts(complexId);
  }

}

import { Resolver, Query, Mutation, Subscription, Args, Int } from '@nestjs/graphql';

import { Notification }                   from '../entities/notification.entity';
import { NotificationsService }           from '../services/notifications.service';
import { FilterNotificationsInput }       from '../dto/inputs/filter-notifications.input';
import { PaginatedNotificationsResponse } from '../dto/responses/paginated-notifications.response';
import { UnreadCountResponse }            from '../dto/responses/unread-count.response';
import { PaginationInput }                from '../../shared/dto/inputs/pagination.input';

import { Auth }             from '../../shared/decorators/auth.decorator';
import { CurrentUser }      from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles }       from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';

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

  // ================================================================
  // SUBSCRIPTIONS — Tiempo real via graphql-ws
  // ================================================================

  /**
   * Suscripción en tiempo real.
   * El cliente recibe notificaciones nuevas sin necesidad de polling.
   *
   * Uso en el cliente (graphql-ws):
   *   subscription {
   *     notificationAdded(complexId: "uuid") { id title body type isRead createdAt }
   *   }
   *
   * El token JWT se envía en el header de conexión WebSocket y el contexto
   * del gateway lo inyecta en `connection.context.user`.
   */
  @Subscription(() => Notification, {
    name: 'notificationAdded',
    /**
     * `filter` se ejecuta en el servidor por cada evento publicado.
     * Aquí no filtramos en el decorator porque ya lo hace el filterIterator
     * del servicio. Lo dejamos como pass-through.
     */
    filter: () => true,
    resolve: (payload: { notificationAdded: Notification }) => payload.notificationAdded,
  })
  notificationAdded(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ) {
    return this.notificationsService.asyncIterator(currentUser.sub, complexId);
  }
}

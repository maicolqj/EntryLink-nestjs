import { NotificationType }         from '../../enums/notification-type.enum';
import { NotificationPriority }     from '../../enums/notification-priority.enum';
import { NotificationActionType }   from '../../enums/notification-action-type.enum';

/**
 * DTO interno (no expuesto por GraphQL) para crear notificaciones
 * desde otros módulos del sistema (PackagesService, VisitsService, etc.)
 */
export interface CreateNotificationPayload {
  type:                NotificationType;
  title:               string;
  body:                string;
  complexId:           string;
  recipientUserId?:    string;          // null = sin destinatario específico (broadcast)
  priority?:           NotificationPriority;
  entityId?:           string;
  entityType?:         string;
  metadata?:           Record<string, any>;
  /** ID del usuario que originó la notificación (guardia, admin, sistema). */
  createdByUserId?:    string;
  /** true si el destinatario debe aprobar/rechazar/confirmar algo. */
  isActionable?:       boolean;
  /** Tipo de acción esperada (solo cuando isActionable = true). */
  actionType?:         NotificationActionType;
  /** Etiqueta del botón principal de acción mostrado en el frontend. */
  actionLabel?:        string;
}

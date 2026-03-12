import { NotificationType }     from '../../enums/notification-type.enum';
import { NotificationPriority } from '../../enums/notification-priority.enum';

/**
 * DTO interno (no expuesto por GraphQL) para crear notificaciones
 * desde otros módulos del sistema (PackagesService, VisitsService, etc.)
 */
export interface CreateNotificationPayload {
  type:             NotificationType;
  title:            string;
  body:             string;
  complexId:        string;
  recipientUserId?: string;          // null = sin destinatario específico (broadcast)
  priority?:        NotificationPriority;
  entityId?:        string;
  entityType?:      string;
  metadata?:        Record<string, any>;
}

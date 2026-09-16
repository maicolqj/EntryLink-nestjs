import { Notification } from '../entities/notification.entity';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { NotificationEntitySnapshot } from '../dto/responses/notification-snapshot.response';

/** Lo que recibe un proveedor para armar el expediente. */
export interface NotificationSnapshotContext {
  notification: Notification;
  /** Quien está abriendo el aviso. El proveedor decide qué puede ver. */
  currentUser: JwtAccessPayload;
}

/** Lo que recibe un proveedor para EJECUTAR una de sus acciones. */
export interface NotificationActionContext extends NotificationSnapshotContext {
  /** Código declarado por el propio proveedor en `build()`. */
  actionCode: string;
  /** Lo que el usuario respondió en los campos de la acción. */
  values: Record<string, unknown>;
}

/**
 * Lo que cada módulo sabe contar sobre sus propias notificaciones.
 *
 * El módulo de notificaciones no conoce mascotas, ni paquetes, ni solicitudes
 * de acceso, y no debería: quien sabe qué datos importan de una ficha de
 * mascota —y cuáles no se le pueden mostrar a quien abre el aviso— es el módulo
 * de mascotas. Cada módulo implementa esto y se registra al arrancar.
 *
 * Devolver `null` significa "no pude armarlo" (la entidad ya no existe, o quien
 * mira no tiene acceso): el servicio cae entonces a lo que quedó guardado en la
 * notificación, que es poco pero nunca miente.
 */
export interface NotificationDetailProvider {
  /** Valores de `notification.entityType` que este proveedor atiende. */
  readonly entityTypes: string[];

  build(
    context: NotificationSnapshotContext,
  ): Promise<NotificationEntitySnapshot | null>;

  /**
   * Ejecuta una de las acciones que este mismo proveedor declaró.
   *
   * Va contra el SERVICIO del módulo, igual que `build()`: ahí viven los
   * permisos, el debido proceso y las notificaciones que salen después. Un
   * proveedor que escriba directo en el repositorio se salta todo eso y
   * convierte el aviso en una puerta trasera del módulo.
   *
   * Opcional: un módulo puede querer mostrar el expediente sin ofrecer nada
   * que hacer sobre él.
   */
  execute?(context: NotificationActionContext): Promise<void>;
}

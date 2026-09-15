import { Injectable, Logger } from '@nestjs/common';

import { NotificationDetailProvider } from '../interfaces/notification-detail-provider.interface';

/**
 * Directorio de quién sabe contar qué.
 *
 * Es un registro en tiempo de arranque y no una lista de imports por una razón
 * concreta: los módulos ya importan a NotificationsModule para poder notificar.
 * Si NotificationsModule importara de vuelta a mascotas, paquetes y visitas
 * para leer sus entidades, cada módulo nuevo tendría que romper su propio ciclo
 * con `forwardRef`. Así la flecha sigue apuntando en un solo sentido: el módulo
 * se presenta, notificaciones solo lo llama.
 */
@Injectable()
export class NotificationDetailRegistry {
  private readonly logger = new Logger(NotificationDetailRegistry.name);
  private readonly providers = new Map<string, NotificationDetailProvider>();

  register(provider: NotificationDetailProvider): void {
    for (const entityType of provider.entityTypes) {
      const key = entityType.toLowerCase();
      const existing = this.providers.get(key);

      if (existing && existing !== provider) {
        this.logger.warn(
          `Dos proveedores para "${entityType}": gana ${provider.constructor.name}`,
        );
      }

      this.providers.set(key, provider);
    }
  }

  resolve(entityType?: string | null): NotificationDetailProvider | null {
    if (!entityType) return null;
    return this.providers.get(entityType.toLowerCase()) ?? null;
  }
}

import { Injectable, OnModuleInit } from '@nestjs/common';

import {
  ANNOUNCEMENT_ENTITY_TYPE,
  PlatformAnnouncementsService,
} from '../services/platform-announcements.service';
import { ANNOUNCEMENT_CATEGORY_LABELS } from '../enums/platform-announcement.enums';
import { NotificationDetailRegistry } from '../../notifications/services/notification-detail.registry';
import {
  NotificationDetailProvider,
  NotificationSnapshotContext,
} from '../../notifications/interfaces/notification-detail-provider.interface';
import {
  NotificationEntitySnapshot,
  NotificationFieldKind,
  NotificationSnapshotTone,
} from '../../notifications/dto/responses/notification-snapshot.response';
import {
  field,
  image,
  section,
  snapshot,
} from '../../notifications/utils/notification-snapshot.util';

/**
 * Detalle de un comunicado de la plataforma: el texto completo y las imágenes.
 *
 * No hay permisos que heredar: quien abre el aviso ya lo recibió, y el
 * comunicado es el mismo para todos sus destinatarios.
 */
@Injectable()
export class PlatformAnnouncementNotificationDetailProvider
  implements NotificationDetailProvider, OnModuleInit
{
  readonly entityTypes = [ANNOUNCEMENT_ENTITY_TYPE];

  constructor(
    private readonly registry: NotificationDetailRegistry,
    private readonly announcementsService: PlatformAnnouncementsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async build({
    notification,
  }: NotificationSnapshotContext): Promise<NotificationEntitySnapshot | null> {
    if (!notification.entityId) return null;

    const announcement = await this.announcementsService.findById(
      notification.entityId,
    );
    if (!announcement) return null;

    return snapshot({
      entityType: ANNOUNCEMENT_ENTITY_TYPE,
      entityId: announcement.id,
      headline: announcement.title,
      statusLabel: ANNOUNCEMENT_CATEGORY_LABELS[announcement.category],
      statusCode: announcement.category,
      statusTone: NotificationSnapshotTone.NEUTRAL,
      sections: [
        section(null, [
          field('Mensaje', announcement.body, NotificationFieldKind.MULTILINE),
          field('Enviado por', 'Equipo EntryLink'),
          field('Fecha', announcement.createdAt, NotificationFieldKind.DATE),
        ]),
      ],
      images: announcement.imageUrls.map((url) => image(url)),
      // Ruta relativa y no URL pública: el archivo lo entrega el backend a
      // quien recibió el comunicado, con su sesión. La web la descarga con el
      // token (ver NotificationSnapshot).
      files: (announcement.attachments ?? []).map((a, index) => ({
        url: `/api/v1/platform-announcements/${announcement.id}/attachments/${index}`,
        label: a.name,
      })),
    });
  }
}

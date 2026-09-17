import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';

import { MarketplaceListingsService } from '../services/marketplace-listings.service';
import { MarketplaceReportsService } from '../services/marketplace-reports.service';
import { MarketplaceListing } from '../entities/marketplace-listing.entity';
import { MarketplaceListingStatus } from '../enums/marketplace-listing-status.enum';
import { MarketplaceListingType } from '../enums/marketplace-listing-type.enum';
import { MarketplacePriceType } from '../enums/marketplace-price-type.enum';
import { MarketplaceItemCondition } from '../enums/marketplace-item-condition.enum';

import { NotificationDetailRegistry } from '../../notifications/services/notification-detail.registry';
import {
  NotificationActionContext,
  NotificationDetailProvider,
  NotificationSnapshotContext,
} from '../../notifications/interfaces/notification-detail-provider.interface';
import {
  NotificationEntitySnapshot,
  NotificationFieldKind,
  NotificationSnapshotTone,
} from '../../notifications/dto/responses/notification-snapshot.response';
import {
  NotificationActionFieldKind,
  NotificationActionTone,
} from '../../notifications/dto/responses/notification-action.response';
import {
  action,
  actionField,
  field,
  image,
  section,
  snapshot,
  unitLabel,
} from '../../notifications/utils/notification-snapshot.util';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { CustomError } from '../../shared/utils/errors.utils';
import { GeneralErrorCode } from '../../shared/constans/error-codes.constants';

const TYPE_LABELS: Record<string, string> = {
  [MarketplaceListingType.PRODUCT]: 'Venta',
  [MarketplaceListingType.SERVICE]: 'Servicio',
  [MarketplaceListingType.RENTAL]: 'Arriendo',
  [MarketplaceListingType.GIVEAWAY]: 'Se regala',
  [MarketplaceListingType.WANTED]: 'Busco',
};

const CONDITION_LABELS: Record<string, string> = {
  [MarketplaceItemCondition.NEW]: 'Nuevo',
  [MarketplaceItemCondition.LIKE_NEW]: 'Como nuevo',
  [MarketplaceItemCondition.USED]: 'Usado',
  [MarketplaceItemCondition.FOR_PARTS]: 'Para repuestos',
};

const STATUS_LABELS: Record<
  string,
  { label: string; tone: NotificationSnapshotTone }
> = {
  [MarketplaceListingStatus.DRAFT]: {
    label: 'Borrador',
    tone: NotificationSnapshotTone.NEUTRAL,
  },
  [MarketplaceListingStatus.PENDING_REVIEW]: {
    label: 'Esperando aprobación',
    tone: NotificationSnapshotTone.WARNING,
  },
  [MarketplaceListingStatus.PUBLISHED]: {
    label: 'Visible en la vitrina',
    tone: NotificationSnapshotTone.POSITIVE,
  },
  [MarketplaceListingStatus.REJECTED]: {
    label: 'No aprobada',
    tone: NotificationSnapshotTone.DANGER,
  },
  [MarketplaceListingStatus.PAUSED]: {
    label: 'Oculta',
    tone: NotificationSnapshotTone.WARNING,
  },
  [MarketplaceListingStatus.SOLD]: {
    label: 'Cerrada',
    tone: NotificationSnapshotTone.NEUTRAL,
  },
  [MarketplaceListingStatus.EXPIRED]: {
    label: 'Vencida',
    tone: NotificationSnapshotTone.NEUTRAL,
  },
  [MarketplaceListingStatus.REMOVED]: {
    label: 'Retirada',
    tone: NotificationSnapshotTone.DANGER,
  },
};

const REPORT_REASON_LABELS: Record<string, string> = {
  PROHIBITED_ITEM: 'Artículo o actividad prohibida',
  SCAM: 'Presunta estafa',
  OFFENSIVE: 'Contenido ofensivo',
  WRONG_CATEGORY: 'Categoría equivocada',
  DUPLICATE: 'Publicación repetida',
  ALREADY_SOLD: 'Ya se vendió',
  OTHER: 'Otro motivo',
};

/**
 * Quién modera. Se repite aquí y solo decide qué botones se PINTAN: quien
 * decide si la acción se ejecuta es el servicio, que es el único sitio donde
 * esa regla puede vivir.
 */
const MODERATOR_ROLES = [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL];

/** Códigos de las acciones. Viajan a la web y vuelven tal cual: son contrato. */
export const MarketplaceActionCode = {
  LISTING_APPROVE: 'MARKETPLACE_LISTING_APPROVE',
  LISTING_REJECT: 'MARKETPLACE_LISTING_REJECT',
  LISTING_RENEW: 'MARKETPLACE_LISTING_RENEW',
} as const;

/**
 * Qué se ve cuando se abre un aviso de clasificados.
 *
 * "Una publicación espera aprobación" no alcanza para aprobar ni rechazar
 * nada: quien modera necesita las fotos, el precio, la categoría y de qué
 * unidad sale. Eso es lo que arma este proveedor.
 *
 * Las consultas pasan por el SERVICIO del módulo y no por el repositorio: así
 * el expediente hereda los mismos permisos que la pantalla —el residente solo
 * abre lo publicado y lo suyo— y, en los reportes, el mismo enmascaramiento de
 * quién reportó. Un expediente que se salte eso expone al vecino que denunció.
 */
@Injectable()
export class MarketplaceNotificationDetailProvider
  implements NotificationDetailProvider, OnModuleInit
{
  readonly entityTypes = ['marketplace_listing', 'marketplaceListing'];

  constructor(
    private readonly registry: NotificationDetailRegistry,
    private readonly listingsService: MarketplaceListingsService,
    private readonly reportsService: MarketplaceReportsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async build({
    notification,
    currentUser,
  }: NotificationSnapshotContext): Promise<NotificationEntitySnapshot | null> {
    if (!notification.entityId) return null;

    const listing: MarketplaceListing = await this.listingsService.findById(
      notification.entityId,
      currentUser,
    );

    const status = STATUS_LABELS[listing.status] ?? {
      label: String(listing.status),
      tone: NotificationSnapshotTone.NEUTRAL,
    };

    const isModerator = currentUser.roles?.some((role) =>
      MODERATOR_ROLES.includes(role),
    );
    const isOwner = listing.ownerUserId === currentUser.sub;

    // El detalle de los reportes es solo para quien modera: lleva el motivo y
    // el comentario de quien reportó, y al autor del aviso no le corresponde.
    const reports = isModerator
      ? await this.reportsService.findPendingByListing(listing.id)
      : [];

    const ownerName = listing.owner
      ? `${listing.owner.name ?? ''} ${listing.owner.lastName ?? ''}`.trim()
      : null;

    return snapshot({
      entityType: 'marketplace_listing',
      entityId: listing.id,
      statusCode: listing.status,
      statusLabel: status.label,
      statusTone: status.tone,
      headline: [TYPE_LABELS[listing.type] ?? listing.type, listing.title]
        .filter(Boolean)
        .join(' · '),
      sections: [
        section('Qué se publica', [
          field('Título', listing.title),
          field('Tipo', TYPE_LABELS[listing.type] ?? listing.type),
          field('Categoría', listing.category?.name),
          field(
            'Estado del artículo',
            listing.condition ? CONDITION_LABELS[listing.condition] : null,
          ),
          field('Precio', this.priceLabel(listing)),
          field(
            'Descripción',
            listing.description,
            NotificationFieldKind.MULTILINE,
          ),
        ]),
        section('Quién publica', [
          field('Residente', ownerName),
          field('Unidad', unitLabel(listing.unit)),
        ]),
        section('Vigencia', [
          field('Publicada', listing.publishedAt, NotificationFieldKind.DATE),
          field('Vence', listing.expiresAt, NotificationFieldKind.DATE),
          field('Vistas', listing.viewsCount),
          field('Interesados', listing.contactsCount),
          field('Motivo', listing.rejectionReason),
        ]),
        // Solo aparece cuando hay reportes: una sección vacía se descarta sola.
        section(
          'Reportes sin resolver',
          reports.map((report, index) =>
            field(
              `Reporte ${index + 1}`,
              [
                REPORT_REASON_LABELS[report.reason] ?? report.reason,
                report.comment,
              ]
                .filter(Boolean)
                .join(' — '),
              NotificationFieldKind.MULTILINE,
            ),
          ),
        ),
      ],
      images: listing.imageUrls.map((url) => image(url)),
      actions: this.buildActions(listing, isModerator, isOwner),
    });
  }

  async execute({
    notification,
    currentUser,
    actionCode,
    values,
  }: NotificationActionContext): Promise<void> {
    const entityId = notification.entityId;
    if (!entityId) return;

    switch (actionCode) {
      case MarketplaceActionCode.LISTING_APPROVE:
        await this.listingsService.approve(
          { listingId: entityId },
          currentUser,
        );
        return;

      case MarketplaceActionCode.LISTING_REJECT:
        await this.listingsService.reject(
          {
            listingId: entityId,
            reason: this.required(values.reason, 'el motivo'),
          },
          currentUser,
        );
        return;

      case MarketplaceActionCode.LISTING_RENEW:
        await this.listingsService.renew(entityId, currentUser);
        return;

      default:
        return;
    }
  }

  private buildActions(
    listing: MarketplaceListing,
    isModerator: boolean,
    isOwner: boolean,
  ) {
    if (
      isModerator &&
      listing.status === MarketplaceListingStatus.PENDING_REVIEW
    ) {
      return [
        action({
          code: MarketplaceActionCode.LISTING_APPROVE,
          label: 'Aprobar',
          description: 'La publicación sale a la vitrina del conjunto',
          tone: NotificationActionTone.PRIMARY,
        }),
        action({
          code: MarketplaceActionCode.LISTING_REJECT,
          label: 'Rechazar',
          description: 'No se publica y su autor recibe el motivo',
          tone: NotificationActionTone.DANGER,
          fields: [
            actionField({
              name: 'reason',
              label: 'Motivo',
              kind: NotificationActionFieldKind.TEXTAREA,
              required: true,
              minLength: 5,
              helpText:
                'Quien publicó necesita saber qué corregir para volver a intentarlo',
            }),
          ],
        }),
      ];
    }

    // El botón de renovar vive en el mismo aviso que dice que está por vencer:
    // obligar a entrar a la app a buscar la publicación es la forma de que se
    // caiga sola.
    if (
      isOwner &&
      (listing.status === MarketplaceListingStatus.PUBLISHED ||
        listing.status === MarketplaceListingStatus.EXPIRED)
    ) {
      return [
        action({
          code: MarketplaceActionCode.LISTING_RENEW,
          label: 'Renovar',
          description: 'Extiende la vigencia del aviso',
          tone: NotificationActionTone.PRIMARY,
        }),
      ];
    }

    return [];
  }

  private priceLabel(listing: MarketplaceListing): string | null {
    switch (listing.priceType) {
      case MarketplacePriceType.FREE:
        return 'Gratis';
      case MarketplacePriceType.EXCHANGE:
        return 'Permuta';
      case MarketplacePriceType.ON_REQUEST:
        return 'A convenir';
      default:
        break;
    }

    if (listing.priceAmount === null || listing.priceAmount === undefined) {
      return null;
    }

    const amount = listing.priceAmount.toLocaleString('es-CO');
    return listing.priceType === MarketplacePriceType.NEGOTIABLE
      ? `$${amount} (negociable)`
      : `$${amount}`;
  }

  private required(value: unknown, label: string): string {
    const text = typeof value === 'string' ? value.trim() : '';

    if (!text) {
      throw new CustomError({
        message: `Falta ${label}`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    return text;
  }
}

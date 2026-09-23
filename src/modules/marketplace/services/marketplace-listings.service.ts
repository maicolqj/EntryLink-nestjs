import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Repository } from 'typeorm';

import { MarketplaceListing } from '../entities/marketplace-listing.entity';
import { MarketplaceListingContact } from '../entities/marketplace-listing-contact.entity';
import { MarketplaceListingFavorite } from '../entities/marketplace-listing-favorite.entity';
import { MarketplaceSettings } from '../entities/marketplace-settings.entity';

import { MarketplaceListingStatus } from '../enums/marketplace-listing-status.enum';
import { MarketplaceListingType } from '../enums/marketplace-listing-type.enum';
import { MarketplacePriceType } from '../enums/marketplace-price-type.enum';
import { MarketplaceModerationMode } from '../enums/marketplace-moderation-mode.enum';
import { MarketplaceContactPreference } from '../enums/marketplace-contact-preference.enum';
import { MarketplaceCategoryKind } from '../enums/marketplace-category-kind.enum';

import { CreateListingDto } from '../dto/inputs/create-listing.input';
import { UpdateListingInput } from '../dto/inputs/update-listing.input';
import { FilterListingsInput } from '../dto/inputs/filter-listings.input';
import { ModerateListingInput } from '../dto/inputs/moderate-listing.input';
import { RegisterListingInterestInput } from '../dto/inputs/register-listing-interest.input';
import { PaginatedListingsResponse } from '../dto/responses/paginated-listings.response';
import { ListingContactResponse } from '../dto/responses/listing-contact.response';
import { MarketplaceStatsResponse } from '../dto/responses/marketplace-stats.response';

import { MarketplaceSettingsService } from './marketplace-settings.service';
import { MarketplaceCategoriesService } from './marketplace-categories.service';
import {
  enabledListingTypes,
  isListingTypeEnabled,
  isMarketplaceModuleEnabled,
  listingDurationFor,
  readBoolean,
} from '../utils/marketplace-module.util';

import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { CustomError } from '../../shared/utils/errors.utils';
import {
  GeneralErrorCode,
  MarketplaceErrorCode,
} from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { UnitService } from '../../residential-complex/services/unit.service';
import { ResidentsService } from '../../residents/services/residents.service';
import { Resident } from '../../residents/entities/resident.entity';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';
import { NotificationActionType } from '../../notifications/enums/notification-action-type.enum';
import { AuditService } from '../../audit/services/audit.service';
import { AuditAction } from '../../audit/enums/audit-action.enum';
import { AuditEntityType } from '../../audit/enums/audit-entity-type.enum';
import { SocketService } from '../../../core/infrastructure/socket/socket.service';
import { SocketEvent } from '../../../core/infrastructure/socket/socket.events';

/** Alta desde el controller: el DTO del REST más las fotos ya subidas a R2. */
export type CreateListingData = CreateListingDto & { imageUrls: string[] };

/** Quien modera la vitrina. La portería y el supervisor no entran al módulo. */
const MODERATOR_ROLES = [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL];

/** Estados que ocupan cupo en la unidad. Lo vendido y lo vencido no cuenta. */
const COUNTED_STATUSES = [
  MarketplaceListingStatus.DRAFT,
  MarketplaceListingStatus.PENDING_REVIEW,
  MarketplaceListingStatus.PUBLISHED,
  MarketplaceListingStatus.PAUSED,
];

/** Estados en los que el aviso todavía es del residente para corregirlo. */
const EDITABLE_STATUSES = [
  MarketplaceListingStatus.DRAFT,
  MarketplaceListingStatus.PENDING_REVIEW,
  MarketplaceListingStatus.REJECTED,
  MarketplaceListingStatus.PUBLISHED,
  MarketplaceListingStatus.PAUSED,
];

/**
 * Estados que cualquier residente del conjunto puede abrir.
 *
 * Lo vendido y lo vencido siguen siendo legibles a propósito: el favorito
 * sobrevive a la caducidad del aviso, y es lo que permite escribirle al vecino
 * "¿todavía la tienes?". Lo que no se abre es lo que nunca salió a la vitrina
 * —borrador, pendiente, rechazado— y lo que está oculto: pausado por su dueño o
 * por reportes.
 */
const VISIBLE_STATUSES = [
  MarketplaceListingStatus.PUBLISHED,
  MarketplaceListingStatus.SOLD,
  MarketplaceListingStatus.EXPIRED,
];

/** Días antes del vencimiento en que se avisa para dar tiempo a renovar. */
const EXPIRY_WARNING_DAYS = 3;

/** Tipos que se pueden publicar sin foto. Ver `assertImages`. */
const PHOTO_OPTIONAL_TYPES: MarketplaceListingType[] = [
  MarketplaceListingType.WANTED,
  MarketplaceListingType.SERVICE,
];

const LISTING_RELATIONS = [
  'category',
  'owner',
  'unit',
  'unit.building',
] as const;

@Injectable()
export class MarketplaceListingsService {
  private readonly logger = new Logger(MarketplaceListingsService.name);

  constructor(
    @InjectRepository(MarketplaceListing)
    private readonly listingRepo: Repository<MarketplaceListing>,
    @InjectRepository(MarketplaceListingContact)
    private readonly contactRepo: Repository<MarketplaceListingContact>,
    @InjectRepository(MarketplaceListingFavorite)
    private readonly favoriteRepo: Repository<MarketplaceListingFavorite>,
    private readonly settingsService: MarketplaceSettingsService,
    private readonly categoriesService: MarketplaceCategoriesService,
    private readonly complexService: ResidentialComplexService,
    private readonly unitService: UnitService,
    private readonly residentsService: ResidentsService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    private readonly socketService: SocketService,
  ) {}

  // ================================================================
  // PUBLICAR
  // ================================================================

  /**
   * Crea el aviso. Dónde queda depende de la política del conjunto: con
   * moderación previa nace esperando aprobación, sin ella sale publicado de
   * una vez.
   *
   * Las fotos ya vienen subidas: quien las sube es el controller, que es el
   * único que puede borrarlas de R2 si esto falla.
   */
  async create(
    data: CreateListingData,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceListing> {
    const complex = await this.complexService.findById(
      data.complexId,
      currentUser,
    );
    this.assertModuleEnabled(complex, currentUser);
    this.assertListingTypeEnabled(complex, data.type, currentUser);

    const settings = await this.settingsService.getOrCreate(data.complexId);
    await this.categoriesService.ensureDefaults(data.complexId);

    if (
      data.type === MarketplaceListingType.WANTED &&
      !settings.allowWantedListings
    ) {
      throw new CustomError({
        message:
          'Este conjunto no admite avisos de "busco / necesito" en la vitrina',
        statusCode: HttpStatus.CONFLICT,
        errorCode: MarketplaceErrorCode.LISTING_WANTED_DISABLED,
      });
    }

    const category = await this.categoriesService.findPublishable(
      data.categoryId,
      data.complexId,
    );
    this.assertCategoryMatchesType(category.kind, data.type);

    const { unitId, residentId } = await this.resolveOwnerContext(
      data.complexId,
      data.unitId,
      currentUser,
    );

    this.assertImages(data.imageUrls, data.type, settings);
    await this.assertUnitQuota(unitId, settings);
    const acceptedTermsAt = await this.resolveTermsAcceptance(
      currentUser,
      readBoolean(data.acceptTerms),
    );

    const asDraft = readBoolean(data.asDraft);
    const publishesNow =
      !asDraft && settings.moderationMode === MarketplaceModerationMode.AUTO;

    const now = new Date();
    const status = asDraft
      ? MarketplaceListingStatus.DRAFT
      : publishesNow
        ? MarketplaceListingStatus.PUBLISHED
        : MarketplaceListingStatus.PENDING_REVIEW;

    const priceType = data.priceType ?? this.defaultPriceType(data.type);
    this.assertPrice(priceType, data.priceAmount);

    const listing = this.listingRepo.create({
      type: data.type,
      title: data.title,
      description: data.description,
      categoryId: data.categoryId,
      condition: data.condition ?? null,
      imageUrls: data.imageUrls,
      priceAmount: data.priceAmount ?? null,
      priceType,
      contactPreference:
        data.contactPreference ?? MarketplaceContactPreference.IN_APP,
      showPhone: readBoolean(data.showPhone),
      status,
      acceptedTermsAt,
      publishedAt: publishesNow ? now : null,
      expiresAt: publishesNow
        ? this.addDays(now, listingDurationFor(data.type, settings))
        : null,
      ownerUserId: currentUser.sub,
      residentId,
      unitId,
      complexId: data.complexId,
    });

    const saved = await this.listingRepo.save(listing);
    this.logger.log(
      `Publicación creada: ${saved.id} — "${saved.title}" — unidad ${unitId} — ${status}`,
    );

    if (status === MarketplaceListingStatus.PENDING_REVIEW) {
      void this.notifyModerators(saved);
    }
    if (status === MarketplaceListingStatus.PUBLISHED) {
      this.emitUpdated(saved);
    }

    void this.auditService.log({
      entityType: AuditEntityType.MarketplaceListing,
      entityId: saved.id,
      action: AuditAction.CREATE,
      newValue: {
        id: saved.id,
        title: saved.title,
        type: saved.type,
        status: saved.status,
        priceAmount: saved.priceAmount,
        unitId,
      },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: data.complexId,
      description: `Publicación creada: ${saved.title}`,
    });

    return this.loadRelations(saved.id);
  }

  /**
   * Corrige un aviso propio.
   *
   * Un aviso ya publicado se puede corregir —bajó el precio, se equivocó en la
   * marca— pero con moderación previa vuelve a la cola: si no, editar sería la
   * puerta para publicar una cosa y dejar otra.
   */
  async update(
    input: UpdateListingInput,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceListing> {
    const listing = await this.findById(input.listingId, currentUser);
    this.assertOwnerOrModerator(listing, currentUser);

    if (!EDITABLE_STATUSES.includes(listing.status)) {
      throw new CustomError({
        message: `Una publicación en estado ${listing.status} ya no se edita`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: MarketplaceErrorCode.LISTING_INVALID_STATUS,
      });
    }

    const settings = await this.settingsService.getOrCreate(listing.complexId);

    if (input.categoryId && input.categoryId !== listing.categoryId) {
      const category = await this.categoriesService.findPublishable(
        input.categoryId,
        listing.complexId,
      );
      this.assertCategoryMatchesType(category.kind, input.type ?? listing.type);
    }

    if (
      input.type === MarketplaceListingType.WANTED &&
      !settings.allowWantedListings
    ) {
      throw new CustomError({
        message:
          'Este conjunto no admite avisos de "busco / necesito" en la vitrina',
        statusCode: HttpStatus.CONFLICT,
        errorCode: MarketplaceErrorCode.LISTING_WANTED_DISABLED,
      });
    }

    // Cambiar el tipo no puede ser la puerta para llevar un aviso a un tablero
    // que el conjunto tiene apagado.
    if (input.type && input.type !== listing.type) {
      const complex = await this.complexService.findById(
        listing.complexId,
        currentUser,
      );
      this.assertListingTypeEnabled(complex, input.type, currentUser);
    }

    if (input.imageUrls) {
      // Solo se admite quitar o reordenar lo que ya está subido. Aceptar una
      // URL nueva aquí sería dejar publicar cualquier enlace externo en la
      // vitrina del conjunto, sin pasar por R2 ni por el tope de fotos.
      const intruder = input.imageUrls.find(
        (url) => !listing.imageUrls.includes(url),
      );

      if (intruder) {
        throw new CustomError({
          message:
            'Las fotos se agregan subiéndolas; aquí solo se pueden quitar o reordenar',
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: GeneralErrorCode.BAD_REQUEST,
        });
      }

      this.assertImages(input.imageUrls, input.type ?? listing.type, settings);
    }

    const priceType = input.priceType ?? listing.priceType;
    const priceAmount =
      input.priceAmount !== undefined ? input.priceAmount : listing.priceAmount;
    this.assertPrice(priceType, priceAmount);

    Object.assign(listing, {
      title: input.title ?? listing.title,
      description: input.description ?? listing.description,
      categoryId: input.categoryId ?? listing.categoryId,
      type: input.type ?? listing.type,
      condition: input.condition ?? listing.condition,
      priceAmount,
      priceType,
      contactPreference: input.contactPreference ?? listing.contactPreference,
      showPhone: input.showPhone ?? listing.showPhone,
      imageUrls: input.imageUrls ?? listing.imageUrls,
      updatedByUserId:
        currentUser.entityType === 'user' ? currentUser.sub : null,
    });

    const returnsToQueue =
      listing.status === MarketplaceListingStatus.PUBLISHED &&
      settings.moderationMode === MarketplaceModerationMode.PREVIA &&
      !this.isModerator(currentUser);

    if (returnsToQueue) {
      listing.status = MarketplaceListingStatus.PENDING_REVIEW;
      listing.publishedAt = null;
    }

    const saved = await this.listingRepo.save(listing);

    if (returnsToQueue) void this.notifyModerators(saved);
    this.emitUpdated(saved);

    return this.loadRelations(saved.id);
  }

  /** Agrega fotos a un aviso. Las sube el controller; aquí solo se guardan. */
  async appendImages(
    listingId: string,
    urls: string[],
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceListing> {
    const listing = await this.findById(listingId, currentUser);
    this.assertOwnerOrModerator(listing, currentUser);

    const settings = await this.settingsService.getOrCreate(listing.complexId);
    const merged = [...listing.imageUrls, ...urls];

    if (merged.length > settings.maxImagesPerListing) {
      throw new CustomError({
        message: `Máximo ${settings.maxImagesPerListing} foto(s) por publicación`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: MarketplaceErrorCode.LISTING_TOO_MANY_IMAGES,
      });
    }

    listing.imageUrls = merged;
    await this.listingRepo.save(listing);

    return this.loadRelations(listing.id);
  }

  /** Manda a revisión un borrador. Con moderación automática ya sale visible. */
  async submit(
    listingId: string,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceListing> {
    const listing = await this.findById(listingId, currentUser);
    this.assertOwnerOrModerator(listing, currentUser);

    if (
      listing.status !== MarketplaceListingStatus.DRAFT &&
      listing.status !== MarketplaceListingStatus.REJECTED
    ) {
      throw new CustomError({
        message: `Solo se manda a revisión un borrador o una publicación rechazada. Estado actual: ${listing.status}`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: MarketplaceErrorCode.LISTING_INVALID_STATUS,
      });
    }

    const settings = await this.settingsService.getOrCreate(listing.complexId);
    this.assertImages(listing.imageUrls, listing.type, settings);
    await this.assertUnitQuota(listing.unitId, settings, listing.id);

    if (settings.moderationMode === MarketplaceModerationMode.AUTO) {
      return this.publishInternal(listing, settings, currentUser);
    }

    listing.status = MarketplaceListingStatus.PENDING_REVIEW;
    listing.rejectionReason = null;
    const saved = await this.listingRepo.save(listing);

    void this.notifyModerators(saved);

    return this.loadRelations(saved.id);
  }

  // ================================================================
  // MODERACIÓN
  // ================================================================

  async approve(
    input: ModerateListingInput,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceListing> {
    const listing = await this.findById(input.listingId, currentUser);

    if (listing.status !== MarketplaceListingStatus.PENDING_REVIEW) {
      throw new CustomError({
        message: `Solo se aprueba una publicación pendiente. Estado actual: ${listing.status}`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: MarketplaceErrorCode.LISTING_INVALID_STATUS,
      });
    }

    const settings = await this.settingsService.getOrCreate(listing.complexId);
    const saved = await this.publishInternal(listing, settings, currentUser);

    void this.notifyOwner(
      saved,
      NotificationType.LISTING_APPROVED,
      'Tu publicación ya está visible',
      `"${saved.title}" quedó publicada en la vitrina del conjunto.`,
    );

    void this.auditService.log({
      entityType: AuditEntityType.MarketplaceListing,
      entityId: saved.id,
      action: AuditAction.APPROVE,
      previousValue: { status: MarketplaceListingStatus.PENDING_REVIEW },
      newValue: { status: MarketplaceListingStatus.PUBLISHED },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: saved.complexId,
      description: `Publicación aprobada: ${saved.title}`,
    });

    return this.loadRelations(saved.id);
  }

  /**
   * Rechaza el aviso con motivo. El motivo es obligatorio: sin él, quien
   * publicó no sabe qué corregir y vuelve a mandar lo mismo.
   */
  async reject(
    input: ModerateListingInput,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceListing> {
    const listing = await this.findById(input.listingId, currentUser);

    if (listing.status !== MarketplaceListingStatus.PENDING_REVIEW) {
      throw new CustomError({
        message: `Solo se rechaza una publicación pendiente. Estado actual: ${listing.status}`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: MarketplaceErrorCode.LISTING_INVALID_STATUS,
      });
    }

    const reason = this.requireReason(input.reason);

    listing.status = MarketplaceListingStatus.REJECTED;
    listing.rejectionReason = reason;
    listing.moderatedAt = new Date();
    listing.moderatedByUserId =
      currentUser.entityType === 'user' ? currentUser.sub : null;

    const saved = await this.listingRepo.save(listing);

    void this.notifyOwner(
      saved,
      NotificationType.LISTING_REJECTED,
      'Tu publicación no se aprobó',
      `"${saved.title}" no se publicó: ${reason}`,
    );

    void this.auditService.log({
      entityType: AuditEntityType.MarketplaceListing,
      entityId: saved.id,
      action: AuditAction.REJECT,
      previousValue: { status: MarketplaceListingStatus.PENDING_REVIEW },
      newValue: { status: MarketplaceListingStatus.REJECTED, reason },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: saved.complexId,
      description: `Publicación rechazada: ${saved.title}`,
    });

    return this.loadRelations(saved.id);
  }

  /** Oculta el aviso sin retirarlo. Lo puede hacer su dueño o la administración. */
  async pause(
    listingId: string,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceListing> {
    const listing = await this.findById(listingId, currentUser);
    this.assertOwnerOrModerator(listing, currentUser);

    if (listing.status !== MarketplaceListingStatus.PUBLISHED) {
      throw new CustomError({
        message: `Solo se pausa una publicación visible. Estado actual: ${listing.status}`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: MarketplaceErrorCode.LISTING_INVALID_STATUS,
      });
    }

    listing.status = MarketplaceListingStatus.PAUSED;
    const saved = await this.listingRepo.save(listing);
    this.emitUpdated(saved);

    return this.loadRelations(saved.id);
  }

  /**
   * Devuelve el aviso a la vitrina.
   *
   * Con reportes sin resolver no vuelve: la administración primero decide sobre
   * ellos. Si no, pausar y reanudar sería la forma de ignorar los reportes.
   */
  async resume(
    listingId: string,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceListing> {
    const listing = await this.findById(listingId, currentUser);
    this.assertOwnerOrModerator(listing, currentUser);

    if (listing.status !== MarketplaceListingStatus.PAUSED) {
      throw new CustomError({
        message: `Solo se reanuda una publicación pausada. Estado actual: ${listing.status}`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: MarketplaceErrorCode.LISTING_INVALID_STATUS,
      });
    }

    if (listing.pendingReportsCount > 0 && !this.isModerator(currentUser)) {
      throw new CustomError({
        message:
          'La publicación tiene reportes sin resolver: la administración debe revisarla antes',
        statusCode: HttpStatus.CONFLICT,
        errorCode: MarketplaceErrorCode.LISTING_INVALID_STATUS,
      });
    }

    const settings = await this.settingsService.getOrCreate(listing.complexId);
    const saved = await this.publishInternal(listing, settings, currentUser, {
      keepExpiry: true,
    });

    return this.loadRelations(saved.id);
  }

  /** Lo vendí / lo entregué. Saca el aviso de la vitrina sin borrarlo. */
  async markAsSold(
    listingId: string,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceListing> {
    const listing = await this.findById(listingId, currentUser);
    this.assertOwnerOrModerator(listing, currentUser);

    if (
      listing.status !== MarketplaceListingStatus.PUBLISHED &&
      listing.status !== MarketplaceListingStatus.PAUSED
    ) {
      throw new CustomError({
        message: `Solo se cierra una publicación vigente. Estado actual: ${listing.status}`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: MarketplaceErrorCode.LISTING_INVALID_STATUS,
      });
    }

    listing.status = MarketplaceListingStatus.SOLD;
    listing.soldAt = new Date();
    const saved = await this.listingRepo.save(listing);
    this.emitUpdated(saved);

    return this.loadRelations(saved.id);
  }

  /**
   * Renueva la vigencia. Es el botón del aviso de "está por vencer" y el que
   * revive lo que ya venció sin obligar a escribirlo todo otra vez.
   */
  async renew(
    listingId: string,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceListing> {
    const listing = await this.findById(listingId, currentUser);
    this.assertOwnerOrModerator(listing, currentUser);

    if (
      listing.status !== MarketplaceListingStatus.PUBLISHED &&
      listing.status !== MarketplaceListingStatus.EXPIRED
    ) {
      throw new CustomError({
        message: `Solo se renueva una publicación vigente o vencida. Estado actual: ${listing.status}`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: MarketplaceErrorCode.LISTING_INVALID_STATUS,
      });
    }

    const settings = await this.settingsService.getOrCreate(listing.complexId);
    const now = new Date();

    listing.status = MarketplaceListingStatus.PUBLISHED;
    listing.publishedAt = listing.publishedAt ?? now;
    listing.expiresAt = this.addDays(
      now,
      listingDurationFor(listing.type, settings),
    );
    listing.renewedAt = now;
    // Se limpia para que el aviso de "por vencer" pueda volver a salir en el
    // siguiente ciclo; si no, se renueva una vez y nunca más se le avisa.
    listing.expiryNotifiedAt = null;

    const saved = await this.listingRepo.save(listing);
    this.emitUpdated(saved);

    return this.loadRelations(saved.id);
  }

  /**
   * Retira el aviso.
   *
   * No se borra: los reportes y los interesados ya registrados apuntan a esta
   * publicación, y un reporte sobre algo que no existe no se puede revisar
   * después. Cuando lo retira la administración, el motivo es obligatorio y al
   * dueño se le avisa.
   */
  async remove(
    listingId: string,
    reason: string | undefined,
    currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    const listing = await this.findById(listingId, currentUser);
    this.assertOwnerOrModerator(listing, currentUser);

    const byModerator =
      this.isModerator(currentUser) && listing.ownerUserId !== currentUser.sub;
    const previousStatus = listing.status;

    if (byModerator) {
      listing.rejectionReason = this.requireReason(reason);
      listing.moderatedAt = new Date();
      listing.moderatedByUserId =
        currentUser.entityType === 'user' ? currentUser.sub : null;
    } else if (reason) {
      listing.rejectionReason = reason.trim();
    }

    listing.status = MarketplaceListingStatus.REMOVED;
    listing.deletedAt = new Date();

    const saved = await this.listingRepo.save(listing);
    this.emitUpdated(saved);

    if (byModerator) {
      void this.notifyOwner(
        saved,
        NotificationType.LISTING_REJECTED,
        'Tu publicación fue retirada',
        `"${saved.title}" se retiró de la vitrina: ${saved.rejectionReason}`,
      );
    }

    void this.auditService.log({
      entityType: AuditEntityType.MarketplaceListing,
      entityId: saved.id,
      action: AuditAction.DELETE,
      previousValue: { status: previousStatus },
      newValue: {
        status: MarketplaceListingStatus.REMOVED,
        reason: saved.rejectionReason,
      },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: saved.complexId,
      description: byModerator
        ? `Publicación retirada por la administración: ${saved.title}`
        : `Publicación retirada por su autor: ${saved.title}`,
    });

    return true;
  }

  // ================================================================
  // INTERÉS Y FAVORITOS
  // ================================================================

  /**
   * "Me interesa": el aviso le llega al publicador con el nombre y la unidad de
   * quien pregunta, y es él quien decide devolver el contacto.
   *
   * Existe porque el sistema no tiene conversación uno a uno: sin esto, la
   * única alternativa sería publicar el teléfono en abierto.
   *
   * Volver a tocar el botón reenvía el aviso pero no crea otra fila —el índice
   * único lo impide— para que el contador que ve el publicador no se infle.
   */
  async registerInterest(
    input: RegisterListingInterestInput,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceListing> {
    const listing = await this.findById(input.listingId, currentUser);

    if (listing.ownerUserId === currentUser.sub) {
      throw new CustomError({
        message: 'Es tu propia publicación',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: MarketplaceErrorCode.LISTING_CONTACT_SELF,
      });
    }

    if (listing.status !== MarketplaceListingStatus.PUBLISHED) {
      throw new CustomError({
        message: 'La publicación ya no está disponible',
        statusCode: HttpStatus.CONFLICT,
        errorCode: MarketplaceErrorCode.LISTING_CONTACT_NOT_AVAILABLE,
      });
    }

    const interestedUnitId = await this.resolveViewerUnitId(
      listing.complexId,
      currentUser,
    );

    const existing = await this.contactRepo.findOne({
      where: { listingId: listing.id, interestedUserId: currentUser.sub },
    });

    if (!existing) {
      // `orIgnore` cubre la carrera contra el índice único; el contador solo
      // sube si la fila es realmente nueva.
      await this.contactRepo
        .createQueryBuilder()
        .insert()
        .into(MarketplaceListingContact)
        .values({
          listingId: listing.id,
          interestedUserId: currentUser.sub,
          interestedUnitId,
          channel: listing.contactPreference,
          message: input.message?.trim() || null,
          complexId: listing.complexId,
        })
        .orIgnore()
        .execute();

      await this.listingRepo.increment({ id: listing.id }, 'contactsCount', 1);
    }

    void this.notifyInterest(listing, input.message, currentUser);

    return this.loadRelations(listing.id);
  }

  /**
   * Guarda o quita el aviso de los favoritos de quien consulta. Devuelve el
   * estado en que quedó.
   */
  async toggleFavorite(
    listingId: string,
    currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    const listing = await this.findById(listingId, currentUser);

    const existing = await this.favoriteRepo.findOne({
      where: { listingId: listing.id, userId: currentUser.sub },
    });

    if (existing) {
      await this.favoriteRepo.delete({ id: existing.id });
      await this.listingRepo.decrement({ id: listing.id }, 'favoritesCount', 1);
      return false;
    }

    await this.favoriteRepo
      .createQueryBuilder()
      .insert()
      .into(MarketplaceListingFavorite)
      .values({
        listingId: listing.id,
        userId: currentUser.sub,
        complexId: listing.complexId,
      })
      .orIgnore()
      .execute();

    await this.listingRepo.increment({ id: listing.id }, 'favoritesCount', 1);
    return true;
  }

  async hasFavorited(listingId: string, userId: string): Promise<boolean> {
    const count = await this.favoriteRepo.count({
      where: { listingId, userId },
    });
    return count > 0;
  }

  async hasContacted(listingId: string, userId: string): Promise<boolean> {
    const count = await this.contactRepo.count({
      where: { listingId, interestedUserId: userId },
    });
    return count > 0;
  }

  /**
   * Cómo contactar al publicador, resuelto para quien está mirando.
   *
   * El teléfono sale solo si su dueño lo destapó Y el conjunto permite ese
   * canal. Las dos condiciones se evalúan aquí y no al publicar: cuando la
   * administración apaga el canal, los avisos que ya lo mostraban dejan de
   * hacerlo sin tocar ninguna publicación.
   */
  async resolveContact(
    listing: MarketplaceListing,
    currentUser: JwtAccessPayload,
  ): Promise<ListingContactResponse> {
    const full = listing.owner ? listing : await this.loadRelations(listing.id);

    const settings = await this.settingsService.getOrCreate(listing.complexId);
    const owner = full.owner;

    const displayName = owner
      ? `${owner.name ?? ''} ${owner.lastName ?? ''}`.trim() || 'Residente'
      : 'Residente';

    const unitLabel =
      [full.unit?.building?.name, full.unit?.number]
        .filter(Boolean)
        .join(' · ') || null;

    const isOwnerViewing = listing.ownerUserId === currentUser.sub;
    const phoneAllowed =
      settings.allowPhoneContact &&
      listing.showPhone &&
      listing.contactPreference !== MarketplaceContactPreference.IN_APP;

    // `countryCode` es un objeto (jsonb), no una cadena: concatenarlo directo
    // deja el teléfono como "[object Object]3001234567" y el enlace de
    // WhatsApp no marca a nadie.
    const dialCode = owner?.countryCode?.dialCode ?? '';

    const phone =
      (phoneAllowed || isOwnerViewing) && owner?.phoneNumber
        ? `${dialCode}${owner.phoneNumber}`
        : null;

    return {
      displayName,
      unitLabel,
      preference: phoneAllowed
        ? listing.contactPreference
        : MarketplaceContactPreference.IN_APP,
      phone,
      inAppOnly: !phoneAllowed,
    };
  }

  // ================================================================
  // CONSULTAS
  // ================================================================

  /**
   * La vitrina.
   *
   * El residente ve lo publicado por los demás y TODO lo suyo, en cualquier
   * estado: su borrador, lo que espera aprobación y lo que le rechazaron. Lo
   * que no ve es el borrador del vecino.
   */
  async findByComplex(
    complexId: string,
    pagination: PaginationInput,
    filters: FilterListingsInput,
    currentUser: JwtAccessPayload,
  ): Promise<PaginatedListingsResponse> {
    const complex = await this.complexService.findById(complexId, currentUser);
    this.assertModuleEnabled(complex, currentUser);
    await this.categoriesService.ensureDefaults(complexId);

    const { page, limit } = pagination;
    const skip = (page - 1) * limit;
    const isModerator = this.isModerator(currentUser);

    const qb = this.listingRepo
      .createQueryBuilder('l')
      .leftJoinAndSelect('l.category', 'category')
      .leftJoinAndSelect('l.owner', 'owner')
      .leftJoinAndSelect('l.unit', 'unit')
      .leftJoinAndSelect('unit.building', 'building')
      .where('l.complexId = :complexId', { complexId })
      .andWhere('l.deletedAt IS NULL');

    if (!isModerator) {
      // En la vitrina solo entra lo que está visible hoy. En "mis favoritos"
      // caben además lo vendido y lo vencido: si se filtraran, el vecino vería
      // desaparecer sin explicación lo que guardó.
      const visibleStatuses = filters?.onlyFavorites
        ? VISIBLE_STATUSES
        : [MarketplaceListingStatus.PUBLISHED];

      qb.andWhere(
        '(l.status IN (:...visibleStatuses) OR l.ownerUserId = :viewerId)',
        { visibleStatuses, viewerId: currentUser.sub },
      );
    }

    if (filters?.onlyMine) {
      qb.andWhere('l.ownerUserId = :ownerId', { ownerId: currentUser.sub });
    }

    if (filters?.onlyFavorites) {
      qb.innerJoin(
        'marketplace_listing_favorites',
        'fav',
        'fav.listing_id = l.id AND fav.user_id = :favUserId',
        { favUserId: currentUser.sub },
      );
    }

    // Solo la administración filtra por reportados: al residente no le
    // corresponde saber qué avisos del vecino están señalados.
    if (filters?.onlyReported && isModerator) {
      qb.andWhere('l.pendingReportsCount > 0');
    }

    if (filters?.status) {
      qb.andWhere('l.status = :status', { status: filters.status });
    } else {
      qb.andWhere('l.status != :removed', {
        removed: MarketplaceListingStatus.REMOVED,
      });
    }

    // El residente solo ve los tableros que su conjunto tiene encendidos: con
    // el directorio apagado, un servicio que quedó publicado no se cuela en la
    // vitrina de clasificados, ni al revés. La administración ve todo para
    // poder terminar de resolver lo que quedó abierto.
    if (!isModerator) {
      qb.andWhere('l.type IN (:...enabledTypes)', {
        enabledTypes: enabledListingTypes(complex),
      });
    }

    if (filters?.type) {
      qb.andWhere('l.type = :type', { type: filters.type });
    }
    if (filters?.excludeTypes?.length) {
      qb.andWhere('l.type NOT IN (:...excludeTypes)', {
        excludeTypes: filters.excludeTypes,
      });
    }
    if (filters?.priceType) {
      qb.andWhere('l.priceType = :priceType', { priceType: filters.priceType });
    }
    if (filters?.categoryId) {
      qb.andWhere('l.categoryId = :categoryId', {
        categoryId: filters.categoryId,
      });
    }
    if (filters?.unitId && isModerator) {
      qb.andWhere('l.unitId = :unitId', { unitId: filters.unitId });
    }
    if (filters?.minPrice !== undefined && filters?.minPrice !== null) {
      qb.andWhere('l.priceAmount >= :minPrice', { minPrice: filters.minPrice });
    }
    if (filters?.maxPrice !== undefined && filters?.maxPrice !== null) {
      qb.andWhere('l.priceAmount <= :maxPrice', { maxPrice: filters.maxPrice });
    }
    if (filters?.search) {
      qb.andWhere('(l.title ILIKE :search OR l.description ILIKE :search)', {
        search: `%${filters.search}%`,
      });
    }

    // Se ordena por el NOMBRE DE LA PROPIEDAD, no por la columna: con joins,
    // `orderBy('l.published_at')` revienta al paginar porque TypeORM no lo
    // traduce y Postgres no encuentra la columna.
    qb.orderBy('l.publishedAt', 'DESC', 'NULLS LAST')
      .addOrderBy('l.createdAt', 'DESC')
      .skip(skip)
      .take(limit);

    const [items, totalItems] = await qb.getManyAndCount();
    const totalPages = Math.ceil(totalItems / limit);

    return {
      items,
      pagination: {
        currentPage: page,
        itemsPerPage: limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  /**
   * Una publicación. El residente puede abrir las publicadas de cualquiera y
   * todas las suyas; el borrador ajeno no.
   */
  async findById(
    id: string,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceListing> {
    const listing = await this.listingRepo.findOne({
      where: { id },
      relations: [...LISTING_RELATIONS],
    });

    if (!listing) {
      throw new CustomError({
        message: `Publicación con ID "${id}" no encontrada`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: MarketplaceErrorCode.LISTING_NOT_FOUND,
      });
    }

    await this.complexService.assertComplexAccess(
      listing.complexId,
      currentUser,
    );

    const isOwner = listing.ownerUserId === currentUser.sub;

    if (
      !isOwner &&
      !this.isModerator(currentUser) &&
      !VISIBLE_STATUSES.includes(listing.status)
    ) {
      throw new CustomError({
        message: 'No tienes acceso a esta publicación',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: MarketplaceErrorCode.LISTING_ACCESS_DENIED,
      });
    }

    return listing;
  }

  /**
   * Abre la ficha y cuenta la visita. Se separa de `findById` porque el mismo
   * método lo usan la moderación y el expediente del aviso, y ahí una visita
   * de la administración inflaría el contador que el vecino lee como interés.
   */
  async findByIdAndCountView(
    id: string,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceListing> {
    const listing = await this.findById(id, currentUser);

    if (
      listing.ownerUserId !== currentUser.sub &&
      !this.isModerator(currentUser)
    ) {
      await this.listingRepo.increment({ id: listing.id }, 'viewsCount', 1);
      listing.viewsCount += 1;
    }

    return listing;
  }

  /** Uso interno del módulo: no valida permisos. */
  async findByIdInternal(id: string): Promise<MarketplaceListing | null> {
    return this.listingRepo.findOne({
      where: { id },
      relations: [...LISTING_RELATIONS],
    });
  }

  /** Los números del encabezado del tablero. */
  async getStats(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceStatsResponse> {
    await this.complexService.assertComplexAccess(complexId, currentUser);

    const soonLimit = this.addDays(new Date(), 7);

    const [published, pendingReview, paused, reported, expiringSoon] =
      await Promise.all([
        this.listingRepo.count({
          where: {
            complexId,
            status: MarketplaceListingStatus.PUBLISHED,
            deletedAt: IsNull(),
          },
        }),
        this.listingRepo.count({
          where: {
            complexId,
            status: MarketplaceListingStatus.PENDING_REVIEW,
            deletedAt: IsNull(),
          },
        }),
        this.listingRepo.count({
          where: {
            complexId,
            status: MarketplaceListingStatus.PAUSED,
            deletedAt: IsNull(),
          },
        }),
        this.listingRepo
          .createQueryBuilder('l')
          .where('l.complexId = :complexId', { complexId })
          .andWhere('l.deletedAt IS NULL')
          .andWhere('l.pendingReportsCount > 0')
          .select('COALESCE(SUM(l.pendingReportsCount), 0)', 'total')
          .getRawOne<{ total: string }>(),
        this.listingRepo.count({
          where: {
            complexId,
            status: MarketplaceListingStatus.PUBLISHED,
            expiresAt: LessThan(soonLimit),
            deletedAt: IsNull(),
          },
        }),
      ]);

    return {
      published,
      pendingReview,
      paused,
      pendingReports: Number(reported?.total ?? 0),
      expiringSoon,
    };
  }

  // ================================================================
  // VIGENCIA (cron)
  // ================================================================

  /**
   * Avisa de lo que está por vencer, con el botón de renovar.
   *
   * `expiryNotifiedAt` es lo que evita el aviso diario durante tres días
   * seguidos: se avisa una vez por ciclo de vigencia y se limpia al renovar.
   */
  async notifyExpiringSoon(): Promise<number> {
    const now = new Date();
    const limit = this.addDays(now, EXPIRY_WARNING_DAYS);

    const candidates = await this.listingRepo
      .createQueryBuilder('l')
      .innerJoinAndSelect('l.complex', 'c')
      .where('l.status = :status', {
        status: MarketplaceListingStatus.PUBLISHED,
      })
      .andWhere('l.deletedAt IS NULL')
      .andWhere('l.expiresAt IS NOT NULL')
      .andWhere('l.expiresAt > :now', { now })
      .andWhere('l.expiresAt <= :limit', { limit })
      .andWhere('l.expiryNotifiedAt IS NULL')
      // Se filtra por el NOMBRE DE LA PROPIEDAD (`c.enabledModules`): el
      // QueryBuilder lo traduce a la columna real, que es camelCase y va
      // entrecomillada. Escribir `c.enabled_modules` a mano pasa el texto tal
      // cual y Postgres responde "column does not exist" —el mismo desfase que
      // dejó el guard de módulos sin bloquear nada—.
      // Cada tipo responde a su interruptor: el servicio avisa si el directorio
      // está encendido, el resto si lo están los clasificados.
      .andWhere(
        `(c.enabledModules IS NULL OR c.enabledModules = '' OR (l.type = :serviceType AND c.enabledModules LIKE '%SERVICIOS%') OR (l.type != :serviceType AND c.enabledModules LIKE '%CLASIFICADOS%'))`,
        { serviceType: MarketplaceListingType.SERVICE },
      )
      .getMany();

    let sent = 0;

    for (const listing of candidates) {
      const days = Math.max(
        0,
        Math.ceil(
          (new Date(listing.expiresAt).getTime() - now.getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      );

      await this.notifyOwner(
        listing,
        NotificationType.LISTING_EXPIRING,
        'Tu publicación está por vencer',
        days <= 1
          ? `"${listing.title}" vence mañana. Renuévala si sigue disponible.`
          : `"${listing.title}" vence en ${days} días. Renuévala si sigue disponible.`,
      );

      listing.expiryNotifiedAt = now;
      await this.listingRepo.save(listing);
      sent++;
    }

    return sent;
  }

  /** Saca de la vitrina lo que venció y avisa a su dueño. */
  async expireOverdue(): Promise<number> {
    const now = new Date();

    const overdue = await this.listingRepo
      .createQueryBuilder('l')
      .innerJoinAndSelect('l.complex', 'c')
      .where('l.status = :status', {
        status: MarketplaceListingStatus.PUBLISHED,
      })
      .andWhere('l.deletedAt IS NULL')
      .andWhere('l.expiresAt IS NOT NULL')
      .andWhere('l.expiresAt <= :now', { now })
      .getMany();

    for (const listing of overdue) {
      listing.status = MarketplaceListingStatus.EXPIRED;
      await this.listingRepo.save(listing);
      this.emitUpdated(listing);

      await this.notifyOwner(
        listing,
        NotificationType.LISTING_EXPIRED,
        'Tu publicación venció',
        `"${listing.title}" salió de la vitrina. Puedes renovarla cuando quieras.`,
      );
    }

    return overdue.length;
  }

  // ================================================================
  // USO INTERNO DEL MÓDULO (reportes)
  // ================================================================

  /**
   * Oculta la publicación porque acumuló reportes.
   *
   * Entre dejar a la vista algo que puede ser un fraude y esconder algo que
   * quizá era legítimo, lo segundo se deshace con un clic. Al dueño se le
   * avisa, pero nunca quién lo reportó.
   */
  async pauseByReports(listing: MarketplaceListing): Promise<void> {
    if (listing.status !== MarketplaceListingStatus.PUBLISHED) return;

    listing.status = MarketplaceListingStatus.PAUSED;
    await this.listingRepo.save(listing);
    this.emitUpdated(listing);

    await this.notifyOwner(
      listing,
      NotificationType.LISTING_PAUSED_BY_REPORTS,
      'Tu publicación se ocultó temporalmente',
      `"${listing.title}" recibió reportes de otros residentes y la administración la está revisando.`,
    );
  }

  /** Retira la publicación porque el reporte procedía. */
  async removeByReport(
    listing: MarketplaceListing,
    reason: string,
    currentUser: JwtAccessPayload,
  ): Promise<void> {
    listing.status = MarketplaceListingStatus.REMOVED;
    listing.rejectionReason = reason;
    listing.deletedAt = new Date();
    listing.moderatedAt = new Date();
    listing.moderatedByUserId =
      currentUser.entityType === 'user' ? currentUser.sub : null;

    await this.listingRepo.save(listing);
    this.emitUpdated(listing);

    await this.notifyOwner(
      listing,
      NotificationType.LISTING_REJECTED,
      'Tu publicación fue retirada',
      `"${listing.title}" se retiró de la vitrina: ${reason}`,
    );
  }

  /** Devuelve a la vitrina lo que se pausó por un reporte que no procedía. */
  async restoreAfterDismissedReport(
    listing: MarketplaceListing,
  ): Promise<void> {
    if (listing.status !== MarketplaceListingStatus.PAUSED) return;
    if (listing.pendingReportsCount > 0) return;

    const settings = await this.settingsService.getOrCreate(listing.complexId);
    const now = new Date();

    listing.status = MarketplaceListingStatus.PUBLISHED;
    listing.publishedAt = listing.publishedAt ?? now;
    listing.expiresAt =
      listing.expiresAt ??
      this.addDays(now, listingDurationFor(listing.type, settings));

    await this.listingRepo.save(listing);
    this.emitUpdated(listing);
  }

  async adjustPendingReports(
    listingId: string,
    delta: number,
  ): Promise<MarketplaceListing> {
    if (delta > 0) {
      await this.listingRepo.increment(
        { id: listingId },
        'pendingReportsCount',
        delta,
      );
    } else if (delta < 0) {
      await this.listingRepo.decrement(
        { id: listingId },
        'pendingReportsCount',
        Math.abs(delta),
      );
    }

    return this.listingRepo.findOne({ where: { id: listingId } });
  }

  // ================================================================
  // HELPERS
  // ================================================================

  isModerator(user: JwtAccessPayload): boolean {
    return user.roles?.some((role) => MODERATOR_ROLES.includes(role)) ?? false;
  }

  /**
   * El módulo se apaga desde la ficha del complejo. A quien modera no se le
   * bloquea: apagarlo le quita la vitrina al residente, no el tablero a quien
   * tiene que terminar de resolver lo que quedó abierto.
   */
  private assertModuleEnabled(
    complex: { enabledModules?: string[] | null },
    currentUser: JwtAccessPayload,
  ): void {
    if (isMarketplaceModuleEnabled(complex) || this.isModerator(currentUser)) {
      return;
    }

    throw new CustomError({
      message: 'El módulo de clasificados no está habilitado en este complejo',
      statusCode: HttpStatus.FORBIDDEN,
      errorCode: MarketplaceErrorCode.MARKETPLACE_MODULE_DISABLED,
    });
  }

  /**
   * Cada tipo de aviso responde a su interruptor: el servicio al directorio,
   * lo demás a clasificados. Tener encendido uno no abre la puerta del otro.
   */
  private assertListingTypeEnabled(
    complex: { enabledModules?: string[] | null },
    type: MarketplaceListingType,
    currentUser: JwtAccessPayload,
  ): void {
    if (isListingTypeEnabled(complex, type) || this.isModerator(currentUser)) {
      return;
    }

    throw new CustomError({
      message:
        type === MarketplaceListingType.SERVICE
          ? 'El directorio de servicios no está habilitado en este complejo'
          : 'El módulo de clasificados no está habilitado en este complejo',
      statusCode: HttpStatus.FORBIDDEN,
      errorCode: MarketplaceErrorCode.MARKETPLACE_MODULE_DISABLED,
    });
  }

  /**
   * Un servicio va en una categoría del directorio y lo demás en una de
   * clasificados. Mezclarlas es lo que llevaba "Plomería" a la vitrina de
   * artículos usados.
   */
  private assertCategoryMatchesType(
    kind: MarketplaceCategoryKind,
    type: MarketplaceListingType,
  ): void {
    const expected =
      type === MarketplaceListingType.SERVICE
        ? MarketplaceCategoryKind.SERVICE
        : MarketplaceCategoryKind.CLASSIFIED;

    if (kind === expected) return;

    throw new CustomError({
      message:
        type === MarketplaceListingType.SERVICE
          ? 'Elige una categoría del directorio de servicios'
          : 'Esa categoría es del directorio de servicios, no de clasificados',
      statusCode: HttpStatus.BAD_REQUEST,
      errorCode: MarketplaceErrorCode.MARKETPLACE_CATEGORY_KIND_MISMATCH,
    });
  }

  /**
   * Un servicio casi nunca tiene tarifa única —depende del trabajo—, así que
   * nace "a convenir". Lo demás sigue naciendo con precio fijo.
   */
  private defaultPriceType(type: MarketplaceListingType): MarketplacePriceType {
    return type === MarketplaceListingType.SERVICE
      ? MarketplacePriceType.ON_REQUEST
      : MarketplacePriceType.FIXED;
  }

  private assertOwnerOrModerator(
    listing: MarketplaceListing,
    currentUser: JwtAccessPayload,
  ): void {
    if (listing.ownerUserId === currentUser.sub) return;
    if (this.isModerator(currentUser)) return;

    throw new CustomError({
      message: 'La publicación no es tuya',
      statusCode: HttpStatus.FORBIDDEN,
      errorCode: MarketplaceErrorCode.LISTING_ACCESS_DENIED,
    });
  }

  /**
   * Un aviso sin foto casi nadie lo abre. Las excepciones son "busco" —quien
   * necesita algo todavía no lo tiene para fotografiarlo— y el servicio: un
   * plomero o una niñera no tienen qué fotografiar, y exigirles foto era la
   * razón por la que nadie terminaba de inscribirse en el directorio.
   */
  private assertImages(
    imageUrls: string[],
    type: MarketplaceListingType,
    settings: MarketplaceSettings,
  ): void {
    if (imageUrls.length === 0 && !PHOTO_OPTIONAL_TYPES.includes(type)) {
      throw new CustomError({
        message: 'La publicación necesita al menos una foto',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: MarketplaceErrorCode.LISTING_IMAGES_REQUIRED,
      });
    }

    if (imageUrls.length > settings.maxImagesPerListing) {
      throw new CustomError({
        message: `Máximo ${settings.maxImagesPerListing} foto(s) por publicación`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: MarketplaceErrorCode.LISTING_TOO_MANY_IMAGES,
      });
    }
  }

  /** Un precio fijo sin monto es una tarjeta que no dice cuánto cuesta. */
  private assertPrice(
    priceType: MarketplacePriceType,
    priceAmount: number | null | undefined,
  ): void {
    const needsAmount =
      priceType === MarketplacePriceType.FIXED ||
      priceType === MarketplacePriceType.NEGOTIABLE;

    if (needsAmount && (priceAmount === null || priceAmount === undefined)) {
      throw new CustomError({
        message: 'Indica el precio o cámbialo a "a convenir"',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: MarketplaceErrorCode.LISTING_PRICE_REQUIRED,
      });
    }
  }

  /**
   * El tope por unidad es contra el vecino que publica veinte cosas y tapa la
   * vitrina, no contra el que vende su nevera.
   */
  private async assertUnitQuota(
    unitId: string,
    settings: MarketplaceSettings,
    ignoreListingId?: string,
  ): Promise<void> {
    if (settings.maxActiveListingsPerUnit <= 0) return;

    const qb = this.listingRepo
      .createQueryBuilder('l')
      .where('l.unitId = :unitId', { unitId })
      .andWhere('l.deletedAt IS NULL')
      .andWhere('l.status IN (:...statuses)', { statuses: COUNTED_STATUSES });

    if (ignoreListingId) {
      qb.andWhere('l.id != :ignoreId', { ignoreId: ignoreListingId });
    }

    const current = await qb.getCount();

    if (current >= settings.maxActiveListingsPerUnit) {
      throw new CustomError({
        message: `La unidad ya tiene ${settings.maxActiveListingsPerUnit} publicación(es) activa(s). Cierra alguna para publicar otra`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: MarketplaceErrorCode.LISTING_MAX_PER_UNIT_REACHED,
      });
    }
  }

  /**
   * Las condiciones se aceptan una vez por persona, no en cada aviso.
   *
   * La fecha se copia a cada publicación a propósito: si un negocio sale mal,
   * lo que importa es qué había aceptado quien publicó ESE aviso, no lo que
   * aceptó alguna vez.
   */
  private async resolveTermsAcceptance(
    currentUser: JwtAccessPayload,
    accepted: boolean,
  ): Promise<Date> {
    if (accepted) return new Date();

    const previous = await this.listingRepo.findOne({
      where: { ownerUserId: currentUser.sub },
      order: { createdAt: 'DESC' },
      select: ['id', 'acceptedTermsAt'],
    });

    if (previous?.acceptedTermsAt) return previous.acceptedTermsAt;

    throw new CustomError({
      message: 'Debes aceptar las condiciones de uso de la vitrina',
      statusCode: HttpStatus.BAD_REQUEST,
      errorCode: MarketplaceErrorCode.LISTING_TERMS_NOT_ACCEPTED,
    });
  }

  /**
   * De qué unidad sale el aviso. El residente publica desde la suya; quien
   * administra —si el conjunto le concede publicar— tiene que decir cuál.
   */
  private async resolveOwnerContext(
    complexId: string,
    inputUnitId: string | undefined,
    currentUser: JwtAccessPayload,
  ): Promise<{ unitId: string; residentId?: string }> {
    if (!this.isModerator(currentUser)) {
      const resident = await this.findResidentProfile(complexId, currentUser);

      if (!resident) {
        throw new CustomError({
          message: 'Solo los residentes de una unidad pueden publicar',
          statusCode: HttpStatus.FORBIDDEN,
          errorCode: MarketplaceErrorCode.LISTING_OWNER_WITHOUT_UNIT,
        });
      }

      if (inputUnitId && inputUnitId !== resident.unitId) {
        throw new CustomError({
          message: 'Solo puedes publicar desde tu propia unidad',
          statusCode: HttpStatus.FORBIDDEN,
          errorCode: GeneralErrorCode.FORBIDDEN,
        });
      }

      return { unitId: resident.unitId, residentId: resident.id };
    }

    if (!inputUnitId) {
      throw new CustomError({
        message: 'Indica la unidad desde la que se publica',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: MarketplaceErrorCode.LISTING_OWNER_WITHOUT_UNIT,
      });
    }

    const unit = await this.unitService.findById(inputUnitId, currentUser);

    if (unit.complexId !== complexId) {
      throw new CustomError({
        message: 'La unidad no pertenece al complejo indicado',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    return { unitId: inputUnitId };
  }

  /**
   * La ficha de residente de quien está operando, o null si no tiene.
   *
   * No tener ficha no es un error: la cuenta del complejo y el SUPER_ADMIN
   * entran al módulo sin vivir en ninguna unidad. Va en try/catch y no en un
   * `.catch()` encadenado porque ese encadenado devuelve `any` y se lleva por
   * delante el tipo de todo lo que venga después.
   */
  private async findResidentProfile(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<Resident | null> {
    try {
      return await this.residentsService.findMyProfile(
        currentUser.sub,
        complexId,
      );
    } catch {
      return null;
    }
  }

  /** La unidad de quien mira, si vive en el conjunto. */
  private async resolveViewerUnitId(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<string | null> {
    const resident = await this.findResidentProfile(complexId, currentUser);
    return resident?.unitId ?? null;
  }

  private async publishInternal(
    listing: MarketplaceListing,
    settings: MarketplaceSettings,
    currentUser: JwtAccessPayload,
    options: { keepExpiry?: boolean } = {},
  ): Promise<MarketplaceListing> {
    const now = new Date();

    listing.status = MarketplaceListingStatus.PUBLISHED;
    listing.publishedAt = listing.publishedAt ?? now;
    listing.rejectionReason = null;
    listing.moderatedAt = now;
    listing.moderatedByUserId =
      currentUser.entityType === 'user' ? currentUser.sub : null;

    const expiryStillValid =
      options.keepExpiry &&
      listing.expiresAt &&
      new Date(listing.expiresAt) > now;

    listing.expiresAt = expiryStillValid
      ? listing.expiresAt
      : this.addDays(now, listingDurationFor(listing.type, settings));

    if (!expiryStillValid) listing.expiryNotifiedAt = null;

    const saved = await this.listingRepo.save(listing);
    this.emitUpdated(saved);

    return saved;
  }

  private requireReason(reason: string | undefined): string {
    const clean = reason?.trim();

    if (!clean) {
      throw new CustomError({
        message: 'Indica el motivo: quien publicó necesita saber qué corregir',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    return clean;
  }

  private addDays(from: Date, days: number): Date {
    const copy = new Date(from);
    copy.setDate(copy.getDate() + days);
    return copy;
  }

  private emitUpdated(listing: MarketplaceListing): void {
    this.socketService.emitToComplex(
      listing.complexId,
      SocketEvent.MARKETPLACE_LISTING_UPDATED,
      {
        listingId: listing.id,
        status: listing.status,
        categoryId: listing.categoryId,
      },
    );
  }

  private async notifyModerators(listing: MarketplaceListing): Promise<void> {
    try {
      const userIds = await this.notificationsService.findUserIdsByRoles(
        listing.complexId,
        [ValidRoles.COMPLEX_ROL],
      );
      if (userIds.length === 0) return;

      await this.notificationsService.notify({
        complexId: listing.complexId,
        userIds,
        type: NotificationType.LISTING_PENDING_REVIEW,
        priority: NotificationPriority.NORMAL,
        title: 'Publicación por revisar',
        body: `"${listing.title}" espera aprobación para salir en la vitrina.`,
        entityId: listing.id,
        entityType: 'marketplace_listing',
        isActionable: true,
        actionType: NotificationActionType.LISTING_APPROVAL,
        actionLabel: 'Revisar publicación',
        metadata: {
          listingId: listing.id,
          title: listing.title,
          unitId: listing.unitId,
        },
      });
    } catch (err) {
      const error = err as Error;
      this.logger.warn(
        `Error al avisar de la publicación ${listing.id}: ${error?.message}`,
      );
    }
  }

  private async notifyOwner(
    listing: MarketplaceListing,
    type: NotificationType,
    title: string,
    body: string,
  ): Promise<void> {
    try {
      await this.notificationsService.notify({
        complexId: listing.complexId,
        userIds: [listing.ownerUserId],
        type,
        priority: NotificationPriority.NORMAL,
        title,
        body,
        entityId: listing.id,
        entityType: 'marketplace_listing',
        metadata: {
          listingId: listing.id,
          title: listing.title,
          status: listing.status,
        },
      });
    } catch (err) {
      const error = err as Error;
      this.logger.warn(
        `Error al avisar al autor de ${listing.id}: ${error?.message}`,
      );
    }
  }

  private async notifyInterest(
    listing: MarketplaceListing,
    message: string | undefined,
    currentUser: JwtAccessPayload,
  ): Promise<void> {
    try {
      const contact = await this.resolveViewerIdentity(
        listing.complexId,
        currentUser,
      );

      await this.notificationsService.notify({
        complexId: listing.complexId,
        userIds: [listing.ownerUserId],
        type: NotificationType.LISTING_INTEREST,
        priority: NotificationPriority.NORMAL,
        title: 'Alguien está interesado',
        body: message?.trim()
          ? `${contact} preguntó por "${listing.title}": ${message.trim()}`
          : `${contact} está interesado en "${listing.title}".`,
        entityId: listing.id,
        entityType: 'marketplace_listing',
        createdByUserId:
          currentUser.entityType === 'user' ? currentUser.sub : undefined,
        metadata: {
          listingId: listing.id,
          title: listing.title,
          interestedBy: contact,
        },
      });
    } catch (err) {
      const error = err as Error;
      this.logger.warn(
        `Error al avisar el interés sobre ${listing.id}: ${error?.message}`,
      );
    }
  }

  /** Nombre y unidad de quien pregunta: es lo que el publicador necesita ver. */
  private async resolveViewerIdentity(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<string> {
    const resident = await this.findResidentProfile(complexId, currentUser);

    const name =
      `${resident?.user?.name ?? ''} ${resident?.user?.lastName ?? ''}`.trim();
    const unit = resident?.unit?.number;

    if (name && unit) return `${name} (unidad ${unit})`;
    return name || 'Un residente';
  }

  private async loadRelations(id: string): Promise<MarketplaceListing> {
    return this.listingRepo.findOne({
      where: { id },
      relations: [...LISTING_RELATIONS],
    });
  }

  /** Publicaciones de una lista de ids. Lo usa el expediente del aviso. */
  async findByIds(ids: string[]): Promise<MarketplaceListing[]> {
    if (ids.length === 0) return [];
    return this.listingRepo.find({ where: { id: In(ids) } });
  }
}

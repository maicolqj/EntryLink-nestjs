import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { MarketplaceListingReport } from '../entities/marketplace-listing-report.entity';
import { MarketplaceReportStatus } from '../enums/marketplace-report-status.enum';
import { MarketplaceListingStatus } from '../enums/marketplace-listing-status.enum';
import { ReportListingInput } from '../dto/inputs/report-listing.input';
import { ResolveListingReportInput } from '../dto/inputs/resolve-listing-report.input';
import { PaginatedListingReportsResponse } from '../dto/responses/paginated-listing-reports.response';

import { MarketplaceListingsService } from './marketplace-listings.service';
import { MarketplaceSettingsService } from './marketplace-settings.service';

import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { CustomError } from '../../shared/utils/errors.utils';
import { MarketplaceErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { ResidentsService } from '../../residents/services/residents.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';
import { AuditService } from '../../audit/services/audit.service';
import { AuditAction } from '../../audit/enums/audit-action.enum';
import { AuditEntityType } from '../../audit/enums/audit-entity-type.enum';

/** Motivos en palabras, para el aviso que le llega a la administración. */
const REASON_LABELS: Record<string, string> = {
  PROHIBITED_ITEM: 'artículo o actividad prohibida',
  SCAM: 'presunta estafa',
  OFFENSIVE: 'contenido ofensivo',
  WRONG_CATEGORY: 'categoría equivocada',
  DUPLICATE: 'publicación repetida',
  ALREADY_SOLD: 'ya se vendió',
  OTHER: 'otro motivo',
};

@Injectable()
export class MarketplaceReportsService {
  private readonly logger = new Logger(MarketplaceReportsService.name);

  constructor(
    @InjectRepository(MarketplaceListingReport)
    private readonly reportRepo: Repository<MarketplaceListingReport>,
    private readonly listingsService: MarketplaceListingsService,
    private readonly settingsService: MarketplaceSettingsService,
    private readonly complexService: ResidentialComplexService,
    private readonly residentsService: ResidentsService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Un vecino reporta una publicación.
   *
   * Quien reporta queda registrado para la administración —hay que poder
   * pedirle contexto y detectar al que reporta por deporte— pero su identidad
   * NUNCA viaja hacia el dueño del aviso: vive tres puertas más allá.
   *
   * Al llegar al tope configurado, la publicación se oculta sola. Es una medida
   * temporal, no un veredicto: la administración decide después.
   */
  async report(
    input: ReportListingInput,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceListingReport> {
    const listing = await this.listingsService.findById(
      input.listingId,
      currentUser,
    );

    if (listing.ownerUserId === currentUser.sub) {
      throw new CustomError({
        message: 'Es tu propia publicación: retírala desde tus avisos',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: MarketplaceErrorCode.LISTING_REPORT_SELF,
      });
    }

    const duplicate = await this.reportRepo.findOne({
      where: {
        listingId: listing.id,
        reporterUserId: currentUser.sub,
        status: MarketplaceReportStatus.PENDING,
      },
    });

    if (duplicate) {
      throw new CustomError({
        message: 'Ya reportaste esta publicación y está en revisión',
        statusCode: HttpStatus.CONFLICT,
        errorCode: MarketplaceErrorCode.LISTING_ALREADY_REPORTED,
      });
    }

    const reporterUnitId = await this.findReporterUnitId(
      listing.complexId,
      currentUser,
    );

    const report = await this.reportRepo.save(
      this.reportRepo.create({
        listingId: listing.id,
        reason: input.reason,
        comment: input.comment?.trim() || null,
        status: MarketplaceReportStatus.PENDING,
        reporterUserId: currentUser.sub,
        reporterUnitId,
        complexId: listing.complexId,
      }),
    );

    const updated = await this.listingsService.adjustPendingReports(
      listing.id,
      1,
    );

    const settings = await this.settingsService.getOrCreate(listing.complexId);
    const reachedThreshold =
      settings.autoPauseAfterReports > 0 &&
      (updated?.pendingReportsCount ?? 0) >= settings.autoPauseAfterReports;

    if (reachedThreshold && updated) {
      await this.listingsService.pauseByReports(updated);
    }

    void this.notifyModerators(
      listing.complexId,
      listing.id,
      listing.title,
      input.reason,
      updated?.pendingReportsCount ?? 1,
      reachedThreshold,
    );

    this.logger.log(
      `Publicación reportada: ${listing.id} — ${input.reason} — total pendientes ${updated?.pendingReportsCount ?? 1}`,
    );

    return report;
  }

  /**
   * La administración resuelve el reporte.
   *
   * Aceptarlo retira la publicación; desestimarlo la devuelve a la vitrina si
   * se había ocultado sola y ya no le queda ningún reporte pendiente. No hay un
   * tercer camino: un reporte que se queda "en estudio" para siempre deja el
   * aviso escondido sin que nadie lo haya decidido.
   */
  async resolve(
    input: ResolveListingReportInput,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceListingReport> {
    const report = await this.reportRepo.findOne({
      where: { id: input.reportId },
    });

    if (!report) {
      throw new CustomError({
        message: 'El reporte no existe',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: MarketplaceErrorCode.LISTING_REPORT_NOT_FOUND,
      });
    }

    await this.complexService.assertComplexAccess(
      report.complexId,
      currentUser,
    );

    if (report.status !== MarketplaceReportStatus.PENDING) {
      throw new CustomError({
        message: 'El reporte ya fue resuelto',
        statusCode: HttpStatus.CONFLICT,
        errorCode: MarketplaceErrorCode.LISTING_REPORT_ALREADY_RESOLVED,
      });
    }

    report.status = input.accept
      ? MarketplaceReportStatus.ACCEPTED
      : MarketplaceReportStatus.DISMISSED;
    report.resolutionNote = input.note?.trim() || null;
    report.resolvedAt = new Date();
    report.resolvedByUserId =
      currentUser.entityType === 'user' ? currentUser.sub : null;

    const saved = await this.reportRepo.save(report);

    const listing = await this.listingsService.adjustPendingReports(
      report.listingId,
      -1,
    );

    if (listing) {
      if (input.accept) {
        if (listing.status !== MarketplaceListingStatus.REMOVED) {
          await this.listingsService.removeByReport(
            listing,
            saved.resolutionNote ??
              `Reporte procedente: ${REASON_LABELS[saved.reason] ?? saved.reason}`,
            currentUser,
          );
        }
      } else {
        await this.listingsService.restoreAfterDismissedReport(listing);
      }
    }

    void this.auditService.log({
      entityType: AuditEntityType.MarketplaceListing,
      entityId: saved.listingId,
      action: input.accept ? AuditAction.REJECT : AuditAction.RESTORE,
      previousValue: { reportStatus: MarketplaceReportStatus.PENDING },
      newValue: { reportStatus: saved.status, note: saved.resolutionNote },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: saved.complexId,
      description: input.accept
        ? 'Reporte aceptado: publicación retirada'
        : 'Reporte desestimado: publicación devuelta a la vitrina',
    });

    return saved;
  }

  /**
   * Los reportes del complejo. Solo los ve quien modera: la lista dice quién
   * reportó a quién.
   */
  async findByComplex(
    complexId: string,
    pagination: PaginationInput,
    status: MarketplaceReportStatus | undefined,
    currentUser: JwtAccessPayload,
  ): Promise<PaginatedListingReportsResponse> {
    await this.complexService.assertComplexAccess(complexId, currentUser);

    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const qb = this.reportRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.listing', 'listing')
      .where('r.complexId = :complexId', { complexId });

    if (status) {
      qb.andWhere('r.status = :status', { status });
    }

    qb.orderBy('r.createdAt', 'DESC').skip(skip).take(limit);

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

  /** Reportes sin resolver de una publicación. Lo usa el expediente del aviso. */
  async findPendingByListing(
    listingId: string,
  ): Promise<MarketplaceListingReport[]> {
    return this.reportRepo.find({
      where: { listingId, status: MarketplaceReportStatus.PENDING },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Desde qué unidad se reportó. Quien reporta puede no tener ficha —la
   * administración también reporta— y eso no es un error.
   */
  private async findReporterUnitId(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<string | null> {
    try {
      const resident = await this.residentsService.findMyProfile(
        currentUser.sub,
        complexId,
      );
      return resident.unitId;
    } catch {
      return null;
    }
  }

  private async notifyModerators(
    complexId: string,
    listingId: string,
    title: string,
    reason: string,
    pendingCount: number,
    autoPaused: boolean,
  ): Promise<void> {
    try {
      const userIds = await this.notificationsService.findUserIdsByRoles(
        complexId,
        [ValidRoles.COMPLEX_ROL],
      );
      if (userIds.length === 0) return;

      const label = REASON_LABELS[reason] ?? 'un motivo sin especificar';

      await this.notificationsService.notify({
        complexId,
        userIds,
        type: NotificationType.LISTING_REPORTED,
        priority: autoPaused
          ? NotificationPriority.HIGH
          : NotificationPriority.NORMAL,
        title: autoPaused
          ? 'Publicación oculta por reportes'
          : 'Publicación reportada',
        body: autoPaused
          ? `"${title}" se ocultó sola tras ${pendingCount} reporte(s): ${label}.`
          : `Un residente reportó "${title}": ${label}.`,
        entityId: listingId,
        entityType: 'marketplace_listing',
        metadata: {
          listingId,
          title,
          reason,
          pendingReports: pendingCount,
        },
      });
    } catch (err) {
      const error = err as Error;
      this.logger.warn(
        `Error al avisar del reporte sobre ${listingId}: ${error?.message}`,
      );
    }
  }
}

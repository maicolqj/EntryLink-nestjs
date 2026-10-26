import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { PlatformAnnouncement } from '../entities/platform-announcement.entity';
import {
  AnnouncementTargetInput,
  SendPlatformAnnouncementDto,
} from '../dto/platform-announcement.inputs';
import {
  AnnouncementTargetPreview,
  PlatformAnnouncementPaginatedResult,
} from '../dto/platform-announcement.responses';
import {
  ANNOUNCEMENT_CATEGORY_LABELS,
  AnnouncementAudience,
  AnnouncementStatus,
  AnnouncementTargetMode,
} from '../enums/platform-announcement.enums';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { ComplexStatus } from '../../residential-complex/enums/complex-status.enum';
import { Resident } from '../../residents/entities/resident.entity';
import { ResidentStatus } from '../../residents/enums/resident-status.enum';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';
import { R2StorageService } from '../../../core/infrastructure/r2/r2.service';
import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../shared/utils/errors.utils';
import { PlatformAnnouncementErrorCode } from '../../shared/constans/error-codes.constants';

/** Tope de imágenes por comunicado. Coincide con el interceptor del controller. */
export const MAX_ANNOUNCEMENT_IMAGES = 4;

export const ANNOUNCEMENT_ENTITY_TYPE = 'platform_announcement';

@Injectable()
export class PlatformAnnouncementsService {
  private readonly logger = new Logger(PlatformAnnouncementsService.name);

  constructor(
    @InjectRepository(PlatformAnnouncement)
    private readonly announcementRepo: Repository<PlatformAnnouncement>,
    @InjectRepository(ResidentialComplex)
    private readonly complexRepo: Repository<ResidentialComplex>,
    @InjectRepository(Resident)
    private readonly residentRepo: Repository<Resident>,
    private readonly notificationsService: NotificationsService,
    private readonly storageService: R2StorageService,
  ) {}

  async previewTarget(
    target: AnnouncementTargetInput,
  ): Promise<AnnouncementTargetPreview> {
    const complexes = await this.resolveComplexes(target);
    return { complexesCount: complexes.length, complexes };
  }

  async findAll(
    pagination: PaginationInput,
  ): Promise<PlatformAnnouncementPaginatedResult> {
    const { page, limit } = pagination;
    const [items, totalItems] = await this.announcementRepo.findAndCount({
      relations: { createdBy: true },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
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

  async findById(id: string): Promise<PlatformAnnouncement | null> {
    return this.announcementRepo.findOne({ where: { id } });
  }

  /**
   * Guarda el comunicado, sube las imágenes y responde. El reparto sigue en
   * segundo plano: con residentes son miles de avisos y push.
   */
  async send(
    dto: SendPlatformAnnouncementDto,
    files: Express.Multer.File[],
    currentUser: JwtAccessPayload,
  ): Promise<PlatformAnnouncement> {
    if (files.length > MAX_ANNOUNCEMENT_IMAGES) {
      throw new CustomError({
        message: `Máximo ${MAX_ANNOUNCEMENT_IMAGES} imágenes por comunicado`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: PlatformAnnouncementErrorCode.ANNOUNCEMENT_TOO_MANY_IMAGES,
      });
    }

    const complexes = await this.resolveComplexes(dto.target);
    if (complexes.length === 0) {
      throw new CustomError({
        message: 'Ningún conjunto cumple con los destinatarios elegidos',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: PlatformAnnouncementErrorCode.ANNOUNCEMENT_NO_TARGETS,
      });
    }

    const imageUrls = await this.uploadImages(files);

    let announcement: PlatformAnnouncement;
    try {
      announcement = await this.announcementRepo.save(
        this.announcementRepo.create({
          category: dto.category,
          title: dto.title.trim(),
          body: dto.body.trim(),
          imageUrls,
          audience: dto.audience,
          targetMode: dto.target.mode,
          complexIds: complexes.map((c) => c.id),
          targetPlans: dto.target.plans ?? [],
          targetStatuses: dto.target.statuses ?? [],
          targetEngagements: dto.target.engagements ?? [],
          complexesCount: complexes.length,
          status: AnnouncementStatus.SENDING,
          createdByUserId:
            currentUser.entityType === 'user' ? currentUser.sub : null,
        }),
      );
    } catch (error) {
      // Sin fila que las muestre, las imágenes quedarían huérfanas en R2.
      await this.purgeImages(imageUrls);
      throw error;
    }

    void this.dispatch(announcement);
    return announcement;
  }

  /** Reparte por conjunto, uno a uno, y deja el total al terminar. */
  private async dispatch(announcement: PlatformAnnouncement): Promise<void> {
    let recipients = 0;
    let failedComplexes = 0;

    for (const complexId of announcement.complexIds) {
      try {
        const userIds = await this.resolveRecipients(
          complexId,
          announcement.audience,
        );
        if (userIds.length === 0) continue;

        const created = await this.notificationsService.notify({
          complexId,
          userIds,
          type: NotificationType.PLATFORM_ANNOUNCEMENT,
          priority: NotificationPriority.NORMAL,
          title: announcement.title,
          body: announcement.body,
          entityId: announcement.id,
          entityType: ANNOUNCEMENT_ENTITY_TYPE,
          metadata: {
            category: announcement.category,
            categoryLabel: ANNOUNCEMENT_CATEGORY_LABELS[announcement.category],
            imageUrls: announcement.imageUrls,
          },
          createdByUserId: announcement.createdByUserId ?? undefined,
        });
        recipients += created.length;
      } catch (error) {
        failedComplexes++;
        this.logger.error(
          `Comunicado ${announcement.id}: falló el reparto al complejo ${complexId} — ${(error as Error).message}`,
        );
      }
    }

    const allFailed =
      failedComplexes > 0 && failedComplexes === announcement.complexIds.length;

    await this.announcementRepo.update(announcement.id, {
      status: allFailed ? AnnouncementStatus.FAILED : AnnouncementStatus.SENT,
      recipientsCount: recipients,
      sentAt: new Date(),
    });

    this.logger.log(
      `Comunicado ${announcement.id} repartido — ${recipients} avisos en ${announcement.complexIds.length} conjuntos` +
        (failedComplexes ? `, ${failedComplexes} con error` : ''),
    );
  }

  /**
   * Conjuntos destino. Los que esperan revisión nunca entran: todavía no son
   * clientes y su cuenta no está habilitada.
   */
  async resolveComplexes(
    target: AnnouncementTargetInput,
  ): Promise<{ id: string; name: string }[]> {
    const qb = this.complexRepo
      .createQueryBuilder('c')
      .select(['c.id', 'c.name'])
      .where('c.deletedAt IS NULL')
      .andWhere('c.status != :pendingReview', {
        pendingReview: ComplexStatus.PENDING_REVIEW,
      })
      .orderBy('c.name', 'ASC');

    if (target.mode === AnnouncementTargetMode.SELECTED) {
      const ids = [...new Set(target.complexIds ?? [])];
      if (ids.length === 0) return [];
      qb.andWhere('c.id IN (:...ids)', { ids });
    }

    if (target.mode === AnnouncementTargetMode.FILTERED) {
      if (target.plans?.length) {
        qb.andWhere('c.plan IN (:...plans)', { plans: target.plans });
      }
      if (target.statuses?.length) {
        qb.andWhere('c.status IN (:...statuses)', {
          statuses: target.statuses,
        });
      }
      if (target.engagements?.length) {
        qb.andWhere('c.engagement IN (:...engagements)', {
          engagements: target.engagements,
        });
      }
    }

    const rows = await qb.getMany();
    return rows.map((c) => ({ id: c.id, name: c.name }));
  }

  /**
   * La administración es la cuenta del complejo: su `sub` es el id del
   * complejo, no un usuario. Los residentes salen de su ficha ACTIVA y no de
   * `users.complex_id`, que viene vacío para quien además administra.
   */
  async resolveRecipients(
    complexId: string,
    audience: AnnouncementAudience,
  ): Promise<string[]> {
    const ids: string[] = [];

    if (audience !== AnnouncementAudience.RESIDENTS) ids.push(complexId);

    if (audience !== AnnouncementAudience.ADMINISTRATION) {
      const rows = await this.residentRepo.find({
        select: { userId: true },
        where: {
          complexId,
          status: ResidentStatus.ACTIVE,
          deletedAt: IsNull(),
          user: { deletedAt: IsNull() },
        },
        relations: { user: true },
      });
      ids.push(...rows.map((r) => r.userId));
    }

    return [...new Set(ids)];
  }

  private async uploadImages(files: Express.Multer.File[]): Promise<string[]> {
    const folder = this.storageService.buildFolder(null, 'announcements');
    const urls: string[] = [];

    try {
      for (const file of files) {
        const result = await this.storageService.uploadBuffer(
          file.buffer,
          folder,
          file.originalname,
        );
        urls.push(result.url);
      }
    } catch (error) {
      await this.purgeImages(urls);
      throw error;
    }

    return urls;
  }

  private async purgeImages(urls: string[]): Promise<void> {
    await Promise.allSettled(
      urls
        .map((url) => this.storageService.keyFromPublicUrl(url))
        .filter((key): key is string => !!key)
        .map((key) => this.storageService.deleteByPublicId(key)),
    );
  }
}

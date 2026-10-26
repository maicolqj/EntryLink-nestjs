import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';

import {
  AnnouncementAttachment,
  PlatformAnnouncement,
} from '../entities/platform-announcement.entity';
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
  AnnouncementChannel,
  AnnouncementStatus,
  AnnouncementTargetMode,
} from '../enums/platform-announcement.enums';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { ComplexStatus } from '../../residential-complex/enums/complex-status.enum';
import { Resident } from '../../residents/entities/resident.entity';
import { ResidentStatus } from '../../residents/enums/resident-status.enum';
import { Notification } from '../../notifications/entities/notification.entity';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';
import { MailService } from '../../../mail/mail.service';
import { R2StorageService } from '../../../core/infrastructure/r2/r2.service';
import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { CustomError } from '../../shared/utils/errors.utils';
import {
  GeneralErrorCode,
  PlatformAnnouncementErrorCode,
} from '../../shared/constans/error-codes.constants';

/** Topes por comunicado. Coinciden con el interceptor del controller. */
export const MAX_ANNOUNCEMENT_IMAGES = 4;
export const MAX_ANNOUNCEMENT_IMAGE_MB = 5;
export const MAX_ANNOUNCEMENT_ATTACHMENTS = 5;
export const MAX_ANNOUNCEMENT_ATTACHMENT_MB = 10;
/** Suma de adjuntos: el correo completo tiene que caber en el proveedor. */
export const MAX_ANNOUNCEMENT_ATTACHMENTS_TOTAL_MB = 20;

/**
 * Pausa entre un correo y el siguiente. Resend acepta 2 por segundo; con
 * margen, un comunicado a 200 conjuntos termina de salir en ~2 minutos.
 */
export const EMAIL_SPACING_MS = 600;

export const ANNOUNCEMENT_ENTITY_TYPE = 'platform_announcement';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MB = 1024 * 1024;

const PLATFORM_STAFF: string[] = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPILANCE_OFFICER_ROL,
];

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
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    private readonly notificationsService: NotificationsService,
    private readonly mailService: MailService,
    private readonly storageService: R2StorageService,
  ) {}

  async previewTarget(
    target: AnnouncementTargetInput,
  ): Promise<AnnouncementTargetPreview> {
    const complexes = await this.resolveComplexes(target);
    return {
      complexesCount: complexes.length,
      withEmailCount: complexes.filter((c) => isValidEmail(c.email)).length,
      complexes: complexes.map(({ id, name }) => ({ id, name })),
    };
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
   * Guarda el comunicado, sube imágenes y adjuntos, y responde. El reparto
   * sigue en segundo plano: con residentes son miles de avisos y push, y los
   * correos salen escalonados.
   */
  async send(
    dto: SendPlatformAnnouncementDto,
    images: Express.Multer.File[],
    attachmentFiles: Express.Multer.File[],
    currentUser: JwtAccessPayload,
  ): Promise<PlatformAnnouncement> {
    this.assertFileLimits(images, attachmentFiles);

    const channels = [
      ...new Set(dto.channels ?? [AnnouncementChannel.NOTIFICATION]),
    ];

    const complexes = await this.resolveComplexes(dto.target);
    if (complexes.length === 0) {
      throw new CustomError({
        message: 'Ningún conjunto cumple con los destinatarios elegidos',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: PlatformAnnouncementErrorCode.ANNOUNCEMENT_NO_TARGETS,
      });
    }

    if (
      channels.length === 1 &&
      channels[0] === AnnouncementChannel.EMAIL &&
      !complexes.some((c) => isValidEmail(c.email))
    ) {
      throw new CustomError({
        message: 'Ninguno de los conjuntos elegidos tiene un correo registrado',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: PlatformAnnouncementErrorCode.ANNOUNCEMENT_NO_EMAILS,
      });
    }

    const uploadedKeys: string[] = [];
    let announcement: PlatformAnnouncement;
    try {
      const imageUrls = await this.uploadImages(images, uploadedKeys);
      const attachments = await this.uploadAttachments(
        attachmentFiles,
        uploadedKeys,
      );

      announcement = await this.announcementRepo.save(
        this.announcementRepo.create({
          category: dto.category,
          title: dto.title.trim(),
          body: dto.body.trim(),
          imageUrls,
          attachments,
          channels,
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
      // Sin fila que los muestre, los archivos quedarían huérfanos en R2.
      await this.purgeKeys(uploadedKeys);
      throw error;
    }

    void this.dispatch(announcement);
    return announcement;
  }

  /**
   * El adjunto `index` del comunicado, si quien lo pide puede verlo: el
   * personal de la plataforma, o quien recibió el aviso (la cuenta del
   * complejo recibe con su propio id como `recipientUserId`).
   */
  async resolveAttachment(
    announcementId: string,
    index: number,
    currentUser: JwtAccessPayload,
  ): Promise<AnnouncementAttachment> {
    const announcement = await this.findById(announcementId);
    const attachment = announcement?.attachments?.[index];
    if (!announcement || !attachment) throw notFound();

    const isStaff = (currentUser.roles ?? []).some((r) =>
      PLATFORM_STAFF.includes(r),
    );
    if (isStaff) return attachment;

    const received = await this.notificationRepo.exist({
      where: {
        entityType: ANNOUNCEMENT_ENTITY_TYPE,
        entityId: announcementId,
        recipientUserId: currentUser.sub,
      },
    });
    // Mismo error que si no existiera: no se confirma qué comunicados hay.
    if (!received) throw notFound();

    return attachment;
  }

  /** Reparte por canal y deja los totales al terminar. */
  private async dispatch(announcement: PlatformAnnouncement): Promise<void> {
    let recipients = 0;
    let emails = 0;
    let failed = 0;
    let attempted = 0;

    if (announcement.channels.includes(AnnouncementChannel.NOTIFICATION)) {
      for (const complexId of announcement.complexIds) {
        attempted++;
        try {
          recipients += await this.notifyComplex(announcement, complexId);
        } catch (error) {
          failed++;
          this.logger.error(
            `Comunicado ${announcement.id}: falló el aviso al complejo ${complexId} — ${(error as Error).message}`,
          );
        }
      }
    }

    if (announcement.channels.includes(AnnouncementChannel.EMAIL)) {
      attempted++;
      try {
        emails = await this.queueEmails(announcement);
      } catch (error) {
        failed++;
        this.logger.error(
          `Comunicado ${announcement.id}: no se pudieron encolar los correos — ${(error as Error).message}`,
        );
      }
    }

    const allFailed = attempted > 0 && failed === attempted;

    await this.announcementRepo.update(announcement.id, {
      status: allFailed ? AnnouncementStatus.FAILED : AnnouncementStatus.SENT,
      recipientsCount: recipients,
      emailsCount: emails,
      sentAt: new Date(),
    });

    this.logger.log(
      `Comunicado ${announcement.id} repartido — ${recipients} avisos y ${emails} correos en ${announcement.complexIds.length} conjuntos` +
        (failed ? `, ${failed} con error` : ''),
    );
  }

  private async notifyComplex(
    announcement: PlatformAnnouncement,
    complexId: string,
  ): Promise<number> {
    const userIds = await this.resolveRecipients(
      complexId,
      announcement.audience,
    );
    if (userIds.length === 0) return 0;

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
        attachmentNames: announcement.attachments.map((a) => a.name),
      },
      createdByUserId: announcement.createdByUserId ?? undefined,
    });
    return created.length;
  }

  /**
   * Un correo por conjunto, al email registrado HOY (no al que tenía al
   * redactar). Cada uno va solo en el "Para": ningún conjunto ve a los demás.
   */
  private async queueEmails(
    announcement: PlatformAnnouncement,
  ): Promise<number> {
    const complexes = await this.complexRepo.find({
      select: { id: true, name: true, email: true },
      where: { id: In(announcement.complexIds) },
      order: { name: 'ASC' },
    });

    let queued = 0;
    for (const complex of complexes) {
      if (!isValidEmail(complex.email)) continue;

      await this.mailService.queuePlatformAnnouncementEmail(
        {
          email: complex.email.trim(),
          complexId: complex.id,
          complexName: complex.name,
          announcementId: announcement.id,
          title: announcement.title,
          body: announcement.body,
          categoryLabel: ANNOUNCEMENT_CATEGORY_LABELS[announcement.category],
          imageUrls: announcement.imageUrls,
          attachments: announcement.attachments.map(
            ({ key, name, mimeType }) => ({ key, name, mimeType }),
          ),
        },
        queued * EMAIL_SPACING_MS,
      );
      queued++;
    }

    return queued;
  }

  /**
   * Conjuntos destino. Los que esperan revisión nunca entran: todavía no son
   * clientes y su cuenta no está habilitada.
   */
  async resolveComplexes(
    target: AnnouncementTargetInput,
  ): Promise<{ id: string; name: string; email?: string | null }[]> {
    const qb = this.complexRepo
      .createQueryBuilder('c')
      .select(['c.id', 'c.name', 'c.email'])
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
    return rows.map((c) => ({ id: c.id, name: c.name, email: c.email }));
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

  private assertFileLimits(
    images: Express.Multer.File[],
    attachments: Express.Multer.File[],
  ): void {
    const fail = (message: string) =>
      new CustomError({
        message,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: PlatformAnnouncementErrorCode.ANNOUNCEMENT_FILES_LIMIT,
      });

    if (images.length > MAX_ANNOUNCEMENT_IMAGES) {
      throw new CustomError({
        message: `Máximo ${MAX_ANNOUNCEMENT_IMAGES} imágenes por comunicado`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: PlatformAnnouncementErrorCode.ANNOUNCEMENT_TOO_MANY_IMAGES,
      });
    }
    if (images.some((f) => f.size > MAX_ANNOUNCEMENT_IMAGE_MB * MB)) {
      throw fail(
        `Cada imagen puede pesar máximo ${MAX_ANNOUNCEMENT_IMAGE_MB} MB`,
      );
    }
    if (attachments.length > MAX_ANNOUNCEMENT_ATTACHMENTS) {
      throw fail(
        `Máximo ${MAX_ANNOUNCEMENT_ATTACHMENTS} archivos adjuntos por comunicado`,
      );
    }
    const total = attachments.reduce((sum, f) => sum + f.size, 0);
    if (total > MAX_ANNOUNCEMENT_ATTACHMENTS_TOTAL_MB * MB) {
      throw fail(
        `Los adjuntos suman más de ${MAX_ANNOUNCEMENT_ATTACHMENTS_TOTAL_MB} MB`,
      );
    }
  }

  private async uploadImages(
    files: Express.Multer.File[],
    uploadedKeys: string[],
  ): Promise<string[]> {
    const folder = this.storageService.buildFolder(null, 'announcements');
    const urls: string[] = [];

    for (const file of files) {
      const result = await this.storageService.uploadBuffer(
        file.buffer,
        folder,
        file.originalname,
      );
      uploadedKeys.push(result.publicId);
      urls.push(result.url);
    }

    return urls;
  }

  /** Se guarda la llave, nunca la URL: el archivo no se sirve público. */
  private async uploadAttachments(
    files: Express.Multer.File[],
    uploadedKeys: string[],
  ): Promise<AnnouncementAttachment[]> {
    const folder = this.storageService.buildFolder(
      null,
      'announcements',
      'attachments',
    );
    const attachments: AnnouncementAttachment[] = [];

    for (const file of files) {
      const result = await this.storageService.uploadBuffer(
        file.buffer,
        folder,
        file.originalname,
        'raw',
      );
      uploadedKeys.push(result.publicId);
      attachments.push({
        key: result.publicId,
        name: decodeFileName(file.originalname),
        mimeType: file.mimetype,
        size: file.size,
      });
    }

    return attachments;
  }

  private async purgeKeys(keys: string[]): Promise<void> {
    await Promise.allSettled(
      keys.map((key) => this.storageService.deleteByPublicId(key)),
    );
  }
}

/**
 * Multer entrega el nombre del archivo leído como latin1: "reunión.pdf" llega
 * como "reuniÃ³n.pdf". Se reinterpreta como UTF-8 salvo que eso lo rompa.
 */
export function decodeFileName(name: string): string {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes(String.fromCharCode(0xfffd)) ? name : decoded;
}

function isValidEmail(email?: string | null): boolean {
  return !!email && EMAIL_RE.test(email.trim());
}

function notFound(): CustomError {
  return new CustomError({
    message: 'Archivo no encontrado',
    statusCode: HttpStatus.NOT_FOUND,
    errorCode: GeneralErrorCode.NOT_FOUND,
  });
}

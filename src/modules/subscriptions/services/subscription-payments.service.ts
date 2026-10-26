import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionPaymentSubmission } from '../entities/subscription-payment-submission.entity';
import {
  PAYMENT_SETTINGS_ID,
  SubscriptionPaymentSettings,
} from '../entities/subscription-payment-settings.entity';
import { SubscriptionPaymentStatus } from '../enums/subscription-payment-status.enum';
import { SubscriptionPeriodKind } from '../enums/subscription-period-kind.enum';
import { SubmitSubscriptionPaymentDto } from '../dto/inputs/submit-subscription-payment.input';
import { SubscriptionPaymentInfo } from '../dto/responses/subscription-payment-info.response';
import { SubscriptionQuote } from '../dto/responses/subscription-quote.response';
import { SubscriptionSummary } from '../dto/responses/subscription-summary.response';
import { formatCop } from '../utils/format-date';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { ComplexPlan } from '../../residential-complex/enums/complex-plan.enum';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';
import { R2StorageService } from '../../../core/infrastructure/r2/r2.service';
import { round2 } from '../../finance/utils/numeric.transformer';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { CustomError } from '../../shared/utils/errors.utils';
import {
  GeneralErrorCode,
  SubscriptionErrorCode,
} from '../../shared/constans/error-codes.constants';

/** El botón de renovar aparece desde estos días antes del vencimiento. */
export const RENEWAL_WINDOW_DAYS = 3;

export const PAYMENT_ENTITY_TYPE = 'subscription_payment';

const PLATFORM_STAFF: string[] = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPILANCE_OFFICER_ROL,
];

/**
 * Renovación con soporte de pago: el conjunto paga con el QR de la plataforma,
 * declara el valor y adjunta el comprobante; el SUPER_ADMIN lo revisa.
 *
 * La única validación automática posible sin pasarela es la del valor: si lo
 * declarado no cubre la cotización del conjunto, el soporte no se recibe y se
 * dice cuánto falta. Que el dinero de verdad haya llegado lo confirma quien
 * revisa la cuenta antes de aprobar.
 */
@Injectable()
export class SubscriptionPaymentsService {
  private readonly logger = new Logger(SubscriptionPaymentsService.name);

  constructor(
    @InjectRepository(SubscriptionPaymentSubmission)
    private readonly submissionRepo: Repository<SubscriptionPaymentSubmission>,
    @InjectRepository(SubscriptionPaymentSettings)
    private readonly settingsRepo: Repository<SubscriptionPaymentSettings>,
    @InjectRepository(ResidentialComplex)
    private readonly complexRepo: Repository<ResidentialComplex>,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly notificationsService: NotificationsService,
    private readonly storageService: R2StorageService,
  ) {}

  // ================================================================
  // DATOS DE PAGO (QR)
  // ================================================================

  async getPaymentInfo(): Promise<SubscriptionPaymentInfo> {
    const settings = await this.settingsRepo.findOne({
      where: { id: PAYMENT_SETTINGS_ID },
    });
    return {
      qrImageUrl: settings?.qrImageUrl ?? null,
      instructions: settings?.instructions ?? null,
      renewalWindowDays: RENEWAL_WINDOW_DAYS,
    };
  }

  /** Cambia el texto y, si llega, reemplaza el QR (el anterior se borra). */
  async updatePaymentSettings(
    instructions: string | undefined,
    qr: Express.Multer.File | undefined,
    userId: string | null,
  ): Promise<SubscriptionPaymentInfo> {
    const current = await this.settingsRepo.findOne({
      where: { id: PAYMENT_SETTINGS_ID },
    });

    let qrImageUrl = current?.qrImageUrl ?? null;
    if (qr) {
      const folder = this.storageService.buildFolder(null, 'subscriptions');
      const uploaded = await this.storageService.uploadBuffer(
        qr.buffer,
        folder,
        qr.originalname,
      );
      qrImageUrl = uploaded.url;

      const oldKey = current?.qrImageUrl
        ? this.storageService.keyFromPublicUrl(current.qrImageUrl)
        : null;
      if (oldKey) {
        await this.storageService.deleteByPublicId(oldKey).catch(() => {
          // Un QR viejo huérfano no afecta a nadie.
        });
      }
    }

    await this.settingsRepo.save({
      id: PAYMENT_SETTINGS_ID,
      qrImageUrl,
      instructions:
        instructions !== undefined
          ? instructions.trim() || null
          : (current?.instructions ?? null),
      updatedByUserId: userId,
    });

    return this.getPaymentInfo();
  }

  // ================================================================
  // ENVÍO DEL SOPORTE (CONJUNTO)
  // ================================================================

  async submit(
    complexId: string,
    dto: SubmitSubscriptionPaymentDto,
    receipt: Express.Multer.File | undefined,
    currentUser: JwtAccessPayload,
  ): Promise<SubscriptionPaymentSubmission> {
    if (!receipt) {
      throw new CustomError({
        message: 'Adjunta el comprobante del pago',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: SubscriptionErrorCode.SUBSCRIPTION_PAYMENT_RECEIPT_REQUIRED,
      });
    }

    const summary = await this.subscriptionsService.getSummary(complexId);
    if (!isRenewalOpen(summary.daysLeft)) {
      throw new CustomError({
        message: `La renovación se habilita en los últimos ${RENEWAL_WINDOW_DAYS} días antes del vencimiento`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: SubscriptionErrorCode.SUBSCRIPTION_RENEWAL_NOT_OPEN,
      });
    }

    const pending = await this.submissionRepo.exist({
      where: { complexId, status: SubscriptionPaymentStatus.PENDING },
    });
    if (pending) {
      throw new CustomError({
        message:
          'Ya enviaste un soporte que está en revisión. Te avisaremos cuando lo revisemos.',
        statusCode: HttpStatus.CONFLICT,
        errorCode: SubscriptionErrorCode.SUBSCRIPTION_PAYMENT_PENDING_EXISTS,
      });
    }

    const { plan, quote } = await this.renewalQuoteFrom(summary);
    if (!quote.configured) {
      throw new CustomError({
        message:
          'Tu conjunto todavía no tiene un valor de suscripción configurado. Comunícate con EntryLink.',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: SubscriptionErrorCode.SUBSCRIPTION_PRICE_NOT_SET,
      });
    }

    const amountPaid = round2(dto.amountPaid);
    const check = checkPaymentCovers(quote.total, amountPaid);
    if (!check.complete) {
      throw new CustomError({
        message: `El pago no está completo: faltan ${formatCop(check.missing)}. Pagaste ${formatCop(amountPaid)} y el valor de tu suscripción es ${formatCop(quote.total)}.`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: SubscriptionErrorCode.SUBSCRIPTION_PAYMENT_INCOMPLETE,
        details: JSON.stringify({
          amountDue: quote.total,
          amountPaid,
          missing: check.missing,
        }),
      });
    }

    const complex = await this.complexRepo.findOne({
      where: { id: complexId },
      select: { id: true, slug: true, name: true },
    });
    const folder = this.storageService.buildFolder(
      complex?.slug,
      'subscriptions',
      'receipts',
    );
    const uploaded = await this.storageService.uploadBuffer(
      receipt.buffer,
      folder,
      receipt.originalname,
      'raw',
    );

    let saved: SubscriptionPaymentSubmission;
    try {
      saved = await this.submissionRepo.save(
        this.submissionRepo.create({
          complexId,
          plan,
          cycle: quote.cycle,
          amountDue: quote.total,
          amountPaid,
          paidAt: dto.paidAt,
          reference: dto.reference?.trim() || null,
          receiptKey: uploaded.publicId,
          receiptName: decodeFileName(receipt.originalname),
          receiptMimeType: receipt.mimetype,
          status: SubscriptionPaymentStatus.PENDING,
          submittedByUserId:
            currentUser.entityType === 'user' ? currentUser.sub : null,
        }),
      );
    } catch (error) {
      await this.storageService
        .deleteByPublicId(uploaded.publicId)
        .catch(() => undefined);
      // Dos envíos a la vez: el índice único deja pasar solo uno.
      if ((error as { code?: string }).code === '23505') {
        throw new CustomError({
          message: 'Ya enviaste un soporte que está en revisión.',
          statusCode: HttpStatus.CONFLICT,
          errorCode: SubscriptionErrorCode.SUBSCRIPTION_PAYMENT_PENDING_EXISTS,
        });
      }
      throw error;
    }

    await this.notifyReviewers(saved, complex?.name ?? summary.complexName);
    return saved;
  }

  /**
   * Lo que el conjunto debe pagar para renovar: su plan y su ciclo, o el plan
   * Básico si viene de la prueba gratis. Es exactamente el valor contra el que
   * se valida el soporte, para que la pantalla no muestre otro.
   */
  async renewalQuote(complexId: string): Promise<SubscriptionQuote> {
    const summary = await this.subscriptionsService.getSummary(complexId);
    return (await this.renewalQuoteFrom(summary)).quote;
  }

  private async renewalQuoteFrom(
    summary: Pick<SubscriptionSummary, 'complexId' | 'plan' | 'quote'>,
  ): Promise<{ plan: ComplexPlan; quote: SubscriptionQuote }> {
    const plan = renewalPlan(summary.plan);
    const quote = await this.subscriptionsService.getQuote(
      summary.complexId,
      plan,
      summary.quote.cycle,
    );
    return { plan, quote };
  }

  // ================================================================
  // REVISIÓN (SUPER_ADMIN)
  // ================================================================

  /**
   * Aprueba: registra el pago con el flujo normal de renovación (que extiende
   * el vencimiento, avisa al conjunto y premia la recomendación).
   *
   * El estado se toma con un UPDATE condicionado antes de renovar: dos clics a
   * la vez no pueden registrar dos periodos. Si la renovación falla, el soporte
   * vuelve a quedar pendiente.
   */
  async approve(
    submissionId: string,
    userId: string,
  ): Promise<SubscriptionPaymentSubmission> {
    const submission = await this.findPendingOrFail(submissionId);
    await this.claim(submission.id, SubscriptionPaymentStatus.APPROVED, userId);

    try {
      const summary = await this.subscriptionsService.renew(
        {
          complexId: submission.complexId,
          plan: submission.plan,
          cycle: submission.cycle,
          amount: submission.amountPaid,
          paidAt: submission.paidAt,
          paymentReference: submission.reference ?? undefined,
          notes: 'Pago con soporte enviado por el conjunto',
        },
        userId,
      );

      // El periodo pagado más reciente es el que acaba de crear `renew`.
      const period = summary.periods
        .filter((p) => p.kind === SubscriptionPeriodKind.PAID)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      await this.submissionRepo.update(submission.id, {
        periodId: period?.id ?? null,
      });
    } catch (error) {
      await this.submissionRepo.update(submission.id, {
        status: SubscriptionPaymentStatus.PENDING,
        reviewedByUserId: null,
        reviewedAt: null,
      });
      throw error;
    }

    return this.findOrFail(submission.id);
  }

  async reject(
    submissionId: string,
    reason: string,
    userId: string,
  ): Promise<SubscriptionPaymentSubmission> {
    const note = reason?.trim();
    if (!note || note.length < 5) {
      throw new CustomError({
        message: 'Escribe el motivo del rechazo',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.INVALID_INPUT,
      });
    }

    const submission = await this.findPendingOrFail(submissionId);
    await this.claim(
      submission.id,
      SubscriptionPaymentStatus.REJECTED,
      userId,
      note,
    );

    await this.subscriptionsService.notifyComplex({
      complexId: submission.complexId,
      type: NotificationType.SUBSCRIPTION_PAYMENT_REJECTED,
      priority: NotificationPriority.HIGH,
      title: 'Soporte de pago rechazado',
      body: `No pudimos validar tu pago de ${formatCop(submission.amountPaid)}. Motivo: ${note}. Puedes enviar un nuevo soporte desde Mi suscripción.`,
      metadata: { submissionId: submission.id, reason: note },
      createdByUserId: userId,
    });

    return this.findOrFail(submission.id);
  }

  // ================================================================
  // CONSULTAS
  // ================================================================

  async listForComplex(
    complexId: string,
  ): Promise<SubscriptionPaymentSubmission[]> {
    return this.submissionRepo.find({
      where: { complexId },
      order: { createdAt: 'DESC' },
      take: 20,
    });
  }

  async findById(id: string): Promise<SubscriptionPaymentSubmission | null> {
    return this.submissionRepo.findOne({
      where: { id },
      relations: { complex: true },
    });
  }

  /**
   * El comprobante, si quien lo pide puede verlo: el personal de la plataforma
   * o la administración del mismo conjunto. A los demás, lo mismo que si no
   * existiera.
   */
  async resolveReceipt(
    submissionId: string,
    currentUser: JwtAccessPayload,
  ): Promise<SubscriptionPaymentSubmission> {
    const submission = await this.submissionRepo.findOne({
      where: { id: submissionId },
    });
    if (!submission) throw notFound();

    const isStaff = (currentUser.roles ?? []).some((r) =>
      PLATFORM_STAFF.includes(r),
    );
    const sessionComplexId =
      currentUser.complexId ??
      (currentUser.entityType === 'complex' ? currentUser.sub : undefined);
    if (!isStaff && sessionComplexId !== submission.complexId) {
      throw notFound();
    }
    return submission;
  }

  // ================================================================
  // AUXILIARES
  // ================================================================

  private async notifyReviewers(
    submission: SubscriptionPaymentSubmission,
    complexName: string,
  ): Promise<void> {
    try {
      const reviewers = await this.notificationsService.findSuperAdminUserIds();
      if (reviewers.length === 0) return;

      await this.notificationsService.notify({
        complexId: submission.complexId,
        userIds: reviewers,
        type: NotificationType.SUBSCRIPTION_PAYMENT_SUBMITTED,
        priority: NotificationPriority.HIGH,
        title: 'Soporte de pago por revisar',
        body: `${complexName} envió un pago de ${formatCop(submission.amountPaid)} para renovar su suscripción.`,
        entityId: submission.id,
        entityType: PAYMENT_ENTITY_TYPE,
        metadata: {
          complexId: submission.complexId,
          amountPaid: submission.amountPaid,
          amountDue: submission.amountDue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `No se pudo avisar del soporte ${submission.id}: ${(err as Error).message}`,
      );
    }
  }

  private async claim(
    id: string,
    status: SubscriptionPaymentStatus,
    userId: string,
    reviewNote?: string,
  ): Promise<void> {
    const result = await this.submissionRepo.update(
      { id, status: SubscriptionPaymentStatus.PENDING },
      {
        status,
        reviewedByUserId: userId,
        reviewedAt: new Date(),
        reviewNote: reviewNote ?? null,
      },
    );
    if (!result.affected) throw notPending();
  }

  private async findPendingOrFail(
    id: string,
  ): Promise<SubscriptionPaymentSubmission> {
    const submission = await this.findOrFail(id);
    if (submission.status !== SubscriptionPaymentStatus.PENDING) {
      throw notPending();
    }
    return submission;
  }

  private async findOrFail(id: string): Promise<SubscriptionPaymentSubmission> {
    const submission = await this.submissionRepo.findOne({ where: { id } });
    if (!submission) throw notFound();
    return submission;
  }
}

/** Abierto desde N días antes y mientras siga vencida (gracia o suspendida). */
export function isRenewalOpen(daysLeft?: number | null): boolean {
  return (
    daysLeft !== null &&
    daysLeft !== undefined &&
    daysLeft <= RENEWAL_WINDOW_DAYS
  );
}

/** Quien sale de la prueba gratis renueva al plan pago más bajo. */
export function renewalPlan(plan: ComplexPlan): ComplexPlan {
  return plan === ComplexPlan.FREE ? ComplexPlan.BASIC : plan;
}

/** Centavos de diferencia por redondeo no cuentan como pago incompleto. */
export function checkPaymentCovers(
  amountDue: number,
  amountPaid: number,
): { complete: boolean; missing: number } {
  const missing = round2(amountDue - amountPaid);
  return missing >= 1
    ? { complete: false, missing }
    : { complete: true, missing: 0 };
}

/**
 * Multer entrega el nombre del archivo leído como latin1: "recibo-año.pdf"
 * llega como "recibo-aÃ±o.pdf". Se reinterpreta como UTF-8 salvo que eso lo
 * rompa.
 */
export function decodeFileName(name: string): string {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes(String.fromCharCode(0xfffd)) ? name : decoded;
}

function notFound(): CustomError {
  return new CustomError({
    message: 'Soporte de pago no encontrado',
    statusCode: HttpStatus.NOT_FOUND,
    errorCode: SubscriptionErrorCode.SUBSCRIPTION_PAYMENT_NOT_FOUND,
  });
}

function notPending(): CustomError {
  return new CustomError({
    message: 'Este soporte ya fue revisado',
    statusCode: HttpStatus.CONFLICT,
    errorCode: SubscriptionErrorCode.SUBSCRIPTION_PAYMENT_NOT_PENDING,
  });
}

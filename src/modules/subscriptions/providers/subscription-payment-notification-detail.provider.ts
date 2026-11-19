import { Injectable, OnModuleInit } from '@nestjs/common';

import {
  PAYMENT_ENTITY_TYPE,
  SubscriptionPaymentsService,
} from '../services/subscription-payments.service';
import { SubscriptionPaymentStatus } from '../enums/subscription-payment-status.enum';
import { BillingCycle } from '../enums/billing-cycle.enum';
import { formatCop } from '../utils/format-date';
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
  section,
  snapshot,
} from '../../notifications/utils/notification-snapshot.util';
import { ValidRoles } from '../../roles/enums/valid-roles';

export const SubscriptionPaymentActionCode = {
  APPROVE: 'SUBSCRIPTION_PAYMENT_APPROVE',
  REJECT: 'SUBSCRIPTION_PAYMENT_REJECT',
} as const;

const STATUS: Record<
  SubscriptionPaymentStatus,
  { label: string; tone: NotificationSnapshotTone }
> = {
  [SubscriptionPaymentStatus.PENDING]: {
    label: 'Por revisar',
    tone: NotificationSnapshotTone.WARNING,
  },
  [SubscriptionPaymentStatus.APPROVED]: {
    label: 'Aprobado',
    tone: NotificationSnapshotTone.POSITIVE,
  },
  [SubscriptionPaymentStatus.REJECTED]: {
    label: 'Rechazado',
    tone: NotificationSnapshotTone.DANGER,
  },
};

/**
 * El aviso "Soporte de pago por revisar" trae lo necesario para decidir sin
 * salir de él: cuánto debía, cuánto declaró, la referencia, el comprobante y
 * los botones para aprobar o rechazar.
 */
@Injectable()
export class SubscriptionPaymentNotificationDetailProvider
  implements NotificationDetailProvider, OnModuleInit
{
  readonly entityTypes = [PAYMENT_ENTITY_TYPE];

  constructor(
    private readonly registry: NotificationDetailRegistry,
    private readonly paymentsService: SubscriptionPaymentsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async build({
    notification,
    currentUser,
  }: NotificationSnapshotContext): Promise<NotificationEntitySnapshot | null> {
    if (!notification.entityId) return null;

    const submission = await this.paymentsService.findById(
      notification.entityId,
    );
    if (!submission) return null;

    const status = STATUS[submission.status];
    const isReviewer = (currentUser.roles ?? []).includes(
      ValidRoles.SUPER_ADMIN_ROL,
    );
    const difference = submission.amountPaid - submission.amountDue;

    return snapshot({
      entityType: PAYMENT_ENTITY_TYPE,
      entityId: submission.id,
      headline: `Pago de ${formatCop(submission.amountPaid)} — ${submission.complex?.name ?? 'Conjunto'}`,
      statusLabel: status.label,
      statusCode: submission.status,
      statusTone: status.tone,
      sections: [
        section('Pago declarado', [
          field(
            'Valor pagado',
            submission.amountPaid,
            NotificationFieldKind.MONEY,
          ),
          field(
            'Valor de la suscripción',
            submission.amountDue,
            NotificationFieldKind.MONEY,
          ),
          difference > 0
            ? field('Pagó de más', difference, NotificationFieldKind.MONEY)
            : null,
          field(
            'Fecha del pago',
            submission.paidAt,
            NotificationFieldKind.DATE,
          ),
          field('Referencia', submission.reference),
        ]),
        section('Renovación', [
          field('Conjunto', submission.complex?.name),
          field('Plan', submission.plan),
          field(
            'Ciclo',
            submission.cycle === BillingCycle.ANNUAL ? 'Anual' : 'Mensual',
          ),
          field('Enviado', submission.createdAt, NotificationFieldKind.DATE),
        ]),
        section('Revisión', [
          field('Revisado', submission.reviewedAt, NotificationFieldKind.DATE),
          field(
            'Motivo del rechazo',
            submission.reviewNote,
            NotificationFieldKind.MULTILINE,
          ),
        ]),
      ],
      // Ruta relativa: el backend entrega el comprobante con la sesión.
      files: [
        {
          url: `/api/v1/subscriptions/payment-submissions/${submission.id}/receipt`,
          label: `Comprobante — ${submission.receiptName}`,
        },
      ],
      actions:
        isReviewer && submission.status === SubscriptionPaymentStatus.PENDING
          ? [
              action({
                code: SubscriptionPaymentActionCode.APPROVE,
                label: 'Aprobar y renovar',
                description:
                  'Confirma que el dinero llegó a la cuenta: se registra el pago y se extiende la suscripción',
                tone: NotificationActionTone.PRIMARY,
                confirmText: `¿Confirmas que recibiste ${formatCop(submission.amountPaid)}?`,
              }),
              action({
                code: SubscriptionPaymentActionCode.REJECT,
                label: 'Rechazar',
                description:
                  'El conjunto recibe el motivo y puede enviar otro soporte',
                tone: NotificationActionTone.DANGER,
                fields: [
                  actionField({
                    name: 'reason',
                    label: 'Motivo',
                    kind: NotificationActionFieldKind.TEXTAREA,
                    required: true,
                    minLength: 5,
                    helpText:
                      'Por ejemplo: el pago no aparece en la cuenta, el comprobante no es legible',
                  }),
                ],
              }),
            ]
          : [],
    });
  }

  async execute({
    notification,
    currentUser,
    actionCode,
    values,
  }: NotificationActionContext): Promise<void> {
    if (!notification.entityId) return;

    switch (actionCode) {
      case SubscriptionPaymentActionCode.APPROVE:
        await this.paymentsService.approve(
          notification.entityId,
          currentUser.sub,
        );
        return;
      case SubscriptionPaymentActionCode.REJECT:
        await this.paymentsService.reject(
          notification.entityId,
          typeof values.reason === 'string' ? values.reason : '',
          currentUser.sub,
        );
        return;
      default:
        return;
    }
  }
}

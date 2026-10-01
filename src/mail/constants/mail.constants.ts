export const MAIL_QUEUE_NAME = 'mail';

export const MAIL_JOBS = {
  SEND_PASSWORD_RESET: 'send-password-reset',
  SEND_EMAIL_VERIFICATION: 'send-email-verification',
  SEND_PANIC_ALERT: 'send-panic-alert',
  SEND_SUBSCRIPTION_NOTICE: 'send-subscription-notice',
} as const;

export interface SendPasswordResetJobPayload {
  userId: string;
  email: string;
  name: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export interface SendEmailVerificationJobPayload {
  userId: string;
  email: string;
  name: string;
  verificationUrl: string;
  expiresInMinutes: number;
}

/**
 * Correo de escalamiento de una alerta de pánico.
 *
 * Es el canal de respaldo que sí funciona hoy: no depende de que el celular del
 * guardia despierte, ni de una plantilla aprobada por Meta, ni de un proveedor
 * de SMS contratado.
 */
export interface SendPanicAlertJobPayload {
  email: string;
  name: string;
  alertId: string;
  complexId: string;
  triggeredByLabel: string;
  triggeredAt: string;
  escalationLevel: number;
  locationUrl?: string;
}

/**
 * Aviso de la suscripción del conjunto (por vencer, vencida, suspendida).
 * Va al correo de la cuenta del complejo, además de la notificación en la
 * plataforma: un aviso de cobro que solo vive dentro del panel no lo ve quien
 * no entra al panel.
 */
export interface SendSubscriptionNoticeJobPayload {
  email: string;
  complexId: string;
  complexName: string;
  title: string;
  message: string;
  /** Línea extra, p. ej. qué sigue funcionando durante la suspensión. */
  note: string;
  ctaUrl: string;
  /** Color del encabezado según la urgencia. */
  tone: 'warning' | 'danger';
}

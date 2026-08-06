export const MAIL_QUEUE_NAME = 'mail';

export const MAIL_JOBS = {
  SEND_PASSWORD_RESET:      'send-password-reset',
  SEND_EMAIL_VERIFICATION:  'send-email-verification',
  SEND_PANIC_ALERT:         'send-panic-alert',
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
  email:            string;
  name:             string;
  alertId:          string;
  complexId:        string;
  triggeredByLabel: string;
  triggeredAt:      string;
  escalationLevel:  number;
  locationUrl?:     string;
}

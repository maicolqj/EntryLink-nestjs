export const MAIL_QUEUE_NAME = 'mail';

export const MAIL_JOBS = {
  SEND_PASSWORD_RESET: 'send-password-reset',
} as const;

export interface SendPasswordResetJobPayload {
  userId: string;
  email: string;
  name: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export const MAIL_QUEUE_NAME = 'mail';

export const MAIL_JOBS = {
  SEND_PASSWORD_RESET:      'send-password-reset',
  SEND_EMAIL_VERIFICATION:  'send-email-verification',
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

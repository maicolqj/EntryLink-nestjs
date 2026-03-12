export const OTP_QUEUE_NAME = 'otp';

export const OTP_JOBS = {
  SEND_OTP: 'send-otp',
} as const;

export interface SendOtpJobPayload {
  userId: string;
  phoneNumber: string;
  code: string;
  expiresInMinutes: number;
}

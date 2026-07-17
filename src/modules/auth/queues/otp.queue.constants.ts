export const OTP_QUEUE_NAME = 'otp';

export const OTP_JOBS = {
  SEND_OTP: 'send-otp',
  SEND_SYSTEM_CODE: 'send-system-code',
} as const;

export interface SendOtpJobPayload {
  userId: string;
  phoneNumber: string;
  code: string;
  expiresInMinutes: number;
}

export interface SendSystemCodeJobPayload {
  userId: string;
  phoneNumber: string;
  systemCode: string;
}

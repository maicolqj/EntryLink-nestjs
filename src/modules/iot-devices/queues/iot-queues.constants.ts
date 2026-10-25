/** Alertas de la matera a partir de una lectura (push + Socket.io). */
export const DEVICE_ALERTS_QUEUE = 'device-alerts';
/** Reenvío de notificaciones de EntryLink (paquete, pánico…) a los aparatos. */
export const DEVICE_NOTIFY_QUEUE = 'device-notify';

export const DEVICE_ALERTS_JOBS = {
  EVALUATE_READING: 'evaluate-reading',
} as const;

export const DEVICE_NOTIFY_JOBS = {
  FROM_ENTRYLINK: 'from-entrylink-notification',
} as const;

export interface EvaluateReadingJob {
  deviceUuid: string;
  readingId: string;
}

/** Lo justo de la notificación de EntryLink para decidir y armar el aviso. */
export interface EntrylinkNotificationJob {
  notificationId: string;
  type: string;
  title: string;
  complexId: string;
  recipientUserId?: string | null;
  isBroadcast: boolean;
  targetRoles: string[];
}

/** Reintentos: Redis o la BD caídos un momento no deben perder el aviso. */
export const IOT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: 1000,
  removeOnFail: 1000,
};

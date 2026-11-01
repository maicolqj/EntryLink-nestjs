import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';

export const GROWTH_IMPORTS_QUEUE = 'growth-imports';

export const IMPORT_JOBS = {
  VALIDATE: 'validate',
  COMMIT: 'commit',
} as const;

export const IMPORT_JOB_ATTEMPTS = 3;

/**
 * Quién confirmó el lote: solo identificadores y roles (sin correo ni datos
 * personales en Redis). Los servicios de 1A lo usan como actor.
 */
export type ImportJobActor = Pick<
  JwtAccessPayload,
  'sub' | 'roles' | 'permissions' | 'entityType'
>;

export interface GrowthImportJob {
  batchId: string;
  actor: ImportJobActor;
  /** Solo en VALIDATE: el mapeo con el que se encoló (ver mappingKeyOf). */
  mappingKey?: string;
}

export function toJobActor(actor: JwtAccessPayload): ImportJobActor {
  return {
    sub: actor.sub,
    roles: actor.roles,
    permissions: actor.permissions,
    entityType: actor.entityType,
  };
}

export function fromJobActor(actor: ImportJobActor): JwtAccessPayload {
  return {
    ...actor,
    email: '',
    type: 'access',
    tokenVersion: 0,
    sessionId: 'growth-import-job',
  };
}

/**
 * Encola validación y confirmación. A diferencia de los trabajos de 1B, aquí
 * un fallo al encolar SÍ se propaga: el lote quedaría en un estado sin nadie
 * que lo procese.
 */
@Injectable()
export class ImportQueueService {
  constructor(
    @InjectQueue(GROWTH_IMPORTS_QUEUE) private readonly queue: Queue,
  ) {}

  async enqueue(
    name: (typeof IMPORT_JOBS)[keyof typeof IMPORT_JOBS],
    data: GrowthImportJob,
  ): Promise<void> {
    await this.queue.add(name, data, {
      // Un mapeo nuevo invalida el anterior: el jobId cambia con cada intento.
      jobId: `${name}:${data.batchId}:${Date.now()}`,
      attempts: IMPORT_JOB_ATTEMPTS,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: true,
      removeOnFail: 50,
    });
  }
}

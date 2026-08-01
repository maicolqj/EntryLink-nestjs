import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { DeviceApprovalStatus } from '../enums/device-approval-status.enum';

/**
 * Solicitud de ingreso que el residente aprueba desde un dispositivo que ya
 * tiene vinculado. El canal de aviso es push (FCM / Web Push), que no tiene
 * costo por mensaje, así que este flujo sustituye al OTP por WhatsApp para
 * quien ya usa la aplicación en otro equipo.
 *
 * Reparto de secretos, igual que en el login por WhatsApp entrante:
 *   - `id` (challengeId) se queda en el dispositivo que pide entrar y es lo
 *     único que canjea la sesión.
 *   - `approvalId` viaja dentro del push a los dispositivos de confianza y
 *     solo sirve para aprobar o rechazar, nunca para obtener tokens.
 * Separarlos evita que quien vea la notificación pueda abrir la sesión, y que
 * quien tenga el challengeId pueda auto-aprobarse.
 *
 * `approvalCode` se muestra en AMBAS pantallas para que el residente compare
 * antes de aprobar (number matching). Es la defensa contra la aprobación a
 * ciegas: sin comparar, un atacante que dispare la solicitud podría lograr que
 * la víctima acepte por reflejo.
 */
@Entity({ name: 'device_approval_requests' })
@Index(['status', 'expiresAt'])
@Index(['userId', 'status'])
export class DeviceApprovalRequest {
  /** Secreto del dispositivo solicitante. Nunca viaja en el push. */
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Secreto que viaja en el push. Solo habilita aprobar o rechazar. */
  @Column({ name: 'approval_id', type: 'uuid', unique: true })
  approvalId: string;

  /** Código corto que el residente compara entre las dos pantallas. */
  @Column({ name: 'approval_code', type: 'varchar', length: 8 })
  approvalCode: string;

  @Column({ name: 'identity', type: 'varchar', length: 20 })
  identity: string;

  /**
   * Residente dueño de la identidad. Nulo si la identidad no existe: la
   * solicitud se emite igual para no revelar qué documentos están registrados,
   * y nunca llega a aprobarse porque no hay a quién notificar.
   */
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId?: string;

  @Column({ name: 'status', type: 'varchar', length: 20, default: DeviceApprovalStatus.PENDING })
  status: DeviceApprovalStatus;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt?: Date;

  /** Sesión desde la que se aprobó o rechazó. Para auditoría. */
  @Column({ name: 'resolved_by_session_id', type: 'text', nullable: true })
  resolvedBySessionId?: string;

  /** Fingerprint del solicitante. El canje exige que coincida. */
  @Column({ name: 'device_fingerprint', type: 'text' })
  deviceFingerprint: string;

  /**
   * Descripción legible del equipo que pide entrar ("Chrome en Windows").
   * Se envía en el push para que el residente pueda juzgar si es suyo.
   */
  @Column({ name: 'requested_from_label', type: 'varchar', length: 120, nullable: true })
  requestedFromLabel?: string;

  @Column({ name: 'requested_from_ip', type: 'varchar', length: 45, nullable: true })
  requestedFromIp?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

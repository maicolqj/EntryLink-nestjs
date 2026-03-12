import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Almacena los OTP generados para autenticación de residentes.
 * Cada OTP tiene una vigencia de 5 minutos y máximo 5 intentos.
 */
@Entity({ name: 'otp_codes' })
@Index(['phoneNumber', 'used', 'expiresAt'])
@Index(['userId'])
export class OtpCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'phone_number', type: 'varchar', length: 20 })
  phoneNumber: string;

  /** Código OTP de 6 dígitos */
  @Column({ name: 'code', type: 'varchar', length: 10 })
  code: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used', type: 'boolean', default: false })
  used: boolean;

  /** Número de intentos fallidos de validación */
  @Column({ name: 'attempts', type: 'smallint', default: 0 })
  attempts: number;

  /** IP desde donde se solicitó el OTP (para auditoría) */
  @Column({ name: 'requested_from_ip', type: 'varchar', length: 45, nullable: true })
  requestedFromIp?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';
import { ObjectType, Field, ID, HideField } from '@nestjs/graphql';
import { User } from '../../users/entities/user.entity';

/**
 * Dispositivo vinculado a un residente.
 *
 * Estrategia de costo cero: el residente prueba su identidad UNA vez por un
 * canal externo (WhatsApp entrante o aprobación desde otro equipo suyo) y a
 * partir de ahí el dispositivo queda vinculado. Los ingresos siguientes se
 * resuelven con la clave de la cuenta, sin ningún mensaje saliente.
 *
 * La clave NO vive acá: es una sola por cuenta (`users.access_code_hash`), así
 * que vincular un equipo nuevo no obliga a inventar otra. Este registro aporta
 * el otro factor: el login exige que coincidan `deviceId` Y `deviceFingerprint`
 * (HMAC de user-agent + deviceId, no falsificable por el cliente porque la
 * llave vive en el servidor).
 */
@ObjectType({ description: 'Dispositivo vinculado a un residente' })
@Entity({ name: 'resident_devices' })
@Unique('UQ_resident_devices_user_device', ['userId', 'deviceId'])
@Index(['deviceId', 'isRevoked'])
export class ResidentDevice {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String)
  @Column({ name: 'user_id', type: 'uuid' })
  @Index()
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Identificador estable enviado por el cliente en el header `x-device-id`. */
  @Field(() => String, { description: 'Identificador del dispositivo (header x-device-id)' })
  @Column({ name: 'device_id', type: 'varchar', length: 128 })
  deviceId: string;

  /**
   * HMAC-SHA256 de user-agent + deviceId calculado en el servidor.
   * Si el residente cambia de navegador/app, el fingerprint deja de coincidir
   * y debe volver a vincular el dispositivo.
   */
  @HideField()
  @Column({ name: 'device_fingerprint', type: 'text' })
  deviceFingerprint: string;

  @Field(() => String, { nullable: true, description: 'Nombre legible del dispositivo' })
  @Column({ name: 'label', type: 'varchar', length: 120, nullable: true })
  label?: string;

  @Field(() => String, { nullable: true })
  @Column({ name: 'platform', type: 'varchar', length: 20, nullable: true })
  platform?: string;

  @Field(() => Boolean)
  @Column({ name: 'is_revoked', type: 'boolean', default: false })
  isRevoked: boolean;

  @Field(() => String, { nullable: true })
  @Column({ name: 'revoked_reason', type: 'varchar', length: 60, nullable: true })
  revokedReason?: string;

  /**
   * Sesión abierta por el último login con este dispositivo. Permite revocar
   * exactamente esa sesión cuando el residente desvincula el equipo (celular
   * perdido) sin tumbar las sesiones de sus otros dispositivos.
   */
  @HideField()
  @Column({ name: 'session_id', type: 'text', nullable: true })
  sessionId?: string;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt?: Date;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

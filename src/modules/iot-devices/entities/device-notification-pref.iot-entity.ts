import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Qué avisos quiere ver el residente en SU aparato. Sin fila = activado.
 * Los obligatorios (catálogo o regla del conjunto) no se pueden desactivar.
 */
@Entity({ name: 'iot_device_notification_prefs' })
@Index(['userId', 'deviceUuid', 'typeKey'], { unique: true })
export class DeviceNotificationPref {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'device_uuid', type: 'uuid' })
  deviceUuid: string;

  @Column({ name: 'type_key', type: 'varchar', length: 32 })
  typeKey: string;

  @Column({ type: 'boolean' })
  enabled: boolean;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

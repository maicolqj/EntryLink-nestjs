import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Lo que decide la administración de un conjunto: qué tipos de aviso son
 * obligatorios en sus aparatos (además de los que ya lo son en el catálogo).
 */
@Entity({ name: 'iot_device_notification_rules' })
@Index(['complexId', 'typeKey'], { unique: true })
export class DeviceNotificationRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Column({ name: 'type_key', type: 'varchar', length: 32 })
  typeKey: string;

  @Column({ type: 'boolean', default: true })
  mandatory: boolean;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

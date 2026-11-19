import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Device } from './device.iot-entity';

/** `cmd` → entrylink/devices/<id>/cmd · `notify` → .../notify */
export type OutboxChannel = 'cmd' | 'notify';

/**
 * Mensajes al dispositivo que esperan a que se conecte. Con USB la matera está
 * siempre conectada y casi nada pasa por aquí; con batería se conecta unos
 * segundos por despertar y recoge lo pendiente al suscribirse.
 *
 * No se usa la persistencia del broker (aedes la guarda en memoria y se pierde
 * al reiniciar el backend). Cada mensaje tiene su caducidad: lo caducado no se
 * entrega nunca (un aviso de visitante de hace 3 h ya no sirve).
 */
@Entity({ name: 'iot_device_outbox' })
@Index(['deviceUuid', 'deliveredAt'])
export class DeviceOutboxMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'device_uuid', type: 'uuid' })
  deviceUuid: string;

  @ManyToOne(() => Device, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'device_uuid' })
  device?: Device;

  @Column({ type: 'varchar', length: 8 })
  channel: OutboxChannel;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

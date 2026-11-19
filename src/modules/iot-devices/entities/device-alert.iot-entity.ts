import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Field, ObjectType } from '@nestjs/graphql';

import { Device } from './device.iot-entity';

/**
 * Registro de cada aviso enviado (auditoría) y base del throttling: antes de
 * avisar se busca el último (device, kind). `kind` es una alerta de la matera
 * (`thirsty`, `tank_empty`, `offline`…) o el tipo de una notificación de
 * EntryLink reenviada al aparato (`PACKAGE`, `PANIC`…).
 */
@ObjectType('IotDeviceAlert', {
  description: 'Aviso enviado por o hacia un dispositivo IoT',
})
@Entity({ name: 'iot_device_alerts' })
@Index(['deviceUuid', 'kind', 'createdAt'])
export class DeviceAlert {
  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String)
  @Column({ name: 'device_uuid', type: 'uuid' })
  deviceUuid: string;

  @ManyToOne(() => Device, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'device_uuid' })
  device?: Device;

  @Field(() => String)
  @Column({ type: 'varchar', length: 40 })
  kind: string;

  /** Por dónde salió: push, socket, socket_admin, device (aro + buzzer + pantalla)… */
  @Field(() => [String])
  @Column({ type: 'text', array: true, default: () => `'{}'` })
  channels: string[];

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

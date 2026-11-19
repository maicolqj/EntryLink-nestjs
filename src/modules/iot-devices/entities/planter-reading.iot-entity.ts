import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

import { Device } from './device.iot-entity';

/**
 * Lectura de una matera (tipo SMART_PLANTER). Es el patrón para otros tipos:
 * cada uno tiene su tabla de lecturas colgando de `Device` (LockEvent, …).
 *
 * `measuredAt` es cuándo se midió (el `ts` del firmware); `createdAt`, cuándo
 * llegó. Las lecturas de la cola sin red llegan tarde y desordenadas: el
 * histórico se ordena por `measuredAt`. El índice único (device, measuredAt)
 * descarta la misma lectura si llega dos veces (MQTT y REST, o reintento).
 */
@ObjectType('PlanterReading', {
  description: 'Lectura de la matera inteligente',
})
@Entity({ name: 'iot_planter_readings' })
@Index(['deviceUuid', 'measuredAt'], { unique: true })
@Index(['deviceUuid', 'createdAt'])
export class PlanterReading {
  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String)
  @Column({ name: 'device_uuid', type: 'uuid' })
  deviceUuid: string;

  @ManyToOne(() => Device, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'device_uuid' })
  device?: Device;

  /** Humedad del suelo, 0-100 %. */
  @Field(() => Int)
  @Column({ type: 'smallint' })
  soil: number;

  @Field(() => Int, { nullable: true })
  @Column({ name: 'soil_raw', type: 'integer', nullable: true })
  soilRaw?: number | null;

  @Field(() => Float, { nullable: true })
  @Column({ type: 'real', nullable: true })
  lux?: number | null;

  @Field(() => Float, { nullable: true })
  @Column({ name: 'temp_c', type: 'real', nullable: true })
  tempC?: number | null;

  /** Humedad del aire, %. */
  @Field(() => Int, { nullable: true })
  @Column({ type: 'smallint', nullable: true })
  hum?: number | null;

  /** Voltios. */
  @Field(() => Float)
  @Column({ type: 'real' })
  battery: number;

  @Field(() => Int, { nullable: true })
  @Column({ name: 'battery_pct', type: 'smallint', nullable: true })
  batteryPct?: number | null;

  /** "usb" | "battery". */
  @Field(() => String, { nullable: true })
  @Column({ type: 'varchar', length: 16, nullable: true })
  power?: string | null;

  /** Firmware: "tank":"ok"|"empty". */
  @Field(() => Boolean)
  @Column({ name: 'tank_has_water', type: 'boolean' })
  tankHasWater: boolean;

  /** Ánimo = nombre de la cara que mostraba ("Thirsty", "Happy / Satisfied"…). */
  @Field(() => String, { nullable: true })
  @Column({ type: 'varchar', length: 40, nullable: true })
  mood?: string | null;

  @Field(() => Boolean, { nullable: true })
  @Column({ type: 'boolean', nullable: true })
  motion?: boolean | null;

  @Field(() => Int, { nullable: true })
  @Column({ type: 'smallint', nullable: true })
  tilt?: number | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'plant_id', type: 'varchar', length: 64, nullable: true })
  plantId?: string | null;

  @Field(() => [String])
  @Column({ type: 'text', array: true, default: () => `'{}'` })
  faults: string[];

  @Field(() => Int, { nullable: true })
  @Column({ type: 'smallint', nullable: true })
  rssi?: number | null;

  /** Salió de la cola sin red de la matera (llegó con retraso). */
  @Field(() => Boolean)
  @Column({ type: 'boolean', default: false })
  queued: boolean;

  @Field(() => Date)
  @Column({ name: 'measured_at', type: 'timestamptz' })
  measuredAt: Date;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

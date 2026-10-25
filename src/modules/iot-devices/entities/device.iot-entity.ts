import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Field, ObjectType } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';

import { DeviceType } from '../enums/device-type.enum';
import { DeviceStatus } from '../enums/device-status.enum';
import { User } from '../../users/entities/user.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { Unit } from '../../residential-complex/entities/unit.entity';

/**
 * Configuración libre por tipo (jsonb). Claves que entiende el backend hoy:
 *  - whatsappEnabled: avisar "tanque vacío" también por WhatsApp
 *  - quietHours: { start: "22:00", end: "07:00", timeZone?: "America/Bogota" }
 *  - notifyComplexAdmins: las alertas de la matera llegan también a la administración
 *  - plant: perfil de planta elegido (lo que se manda en set_plant y en GET /plant)
 */
export interface DeviceConfig {
  whatsappEnabled?: boolean;
  quietHours?: { start: string; end: string; timeZone?: string };
  notifyComplexAdmins?: boolean;
  plant?: PlantProfile;
  [clave: string]: unknown;
}

/** Perfil de planta: mismo JSON que `set_plant` (sin "cmd") y que GET /plant. */
export interface PlantProfile {
  plantId: string;
  nombre: string;
  thresholds: Record<string, number>;
}

/**
 * Dispositivo IoT genérico (matera, cerradura, sensor…). La telemetría vive en
 * una tabla por tipo (`PlanterReading` para la matera); esta entidad no cambia
 * al agregar tipos.
 *
 * Archivo `*.iot-entity.ts` y no `*.entity.ts`: así el glob global de TypeORM
 * no la carga y, con IOT_ENABLED apagado, no existe ni como metadato.
 */
@ObjectType('IotDevice', { description: 'Dispositivo IoT (matera Niko, …)' })
@Entity({ name: 'iot_devices' })
@Index(['complexId'])
@Index(['ownerId'])
@Index(['pairingCode'], { unique: true, where: `"pairing_code" IS NOT NULL` })
export class Device {
  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => DeviceType)
  @Column({ type: 'varchar', length: 32 })
  type: DeviceType;

  /** Identificador público (va en el firmware y en los topics MQTT). */
  @Field(() => String)
  @Column({ name: 'device_id', type: 'varchar', length: 40, unique: true })
  deviceId: string;

  /** bcrypt del deviceKey. Nunca se expone ni se selecciona por defecto. */
  @Column({
    name: 'device_key_hash',
    type: 'varchar',
    length: 100,
    select: false,
  })
  deviceKeyHash: string;

  /** Código corto de vinculación (QR #2). De un solo uso. */
  @Field(() => String, { nullable: true })
  @Column({ name: 'pairing_code', type: 'varchar', length: 12, nullable: true })
  pairingCode?: string | null;

  @Field(() => Date, { nullable: true })
  @Column({
    name: 'pairing_code_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  pairingCodeExpiresAt?: Date | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'varchar', length: 80, nullable: true })
  name?: string | null;

  @Field(() => String, { nullable: true })
  @Column({
    name: 'firmware_version',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  firmwareVersion?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'owner_id', type: 'uuid', nullable: true })
  ownerId?: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'owner_id' })
  owner?: User | null;

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @ManyToOne(() => ResidentialComplex, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;

  @Field(() => String, { nullable: true })
  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId?: string | null;

  @ManyToOne(() => Unit, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'unit_id' })
  unit?: Unit | null;

  @Field(() => DeviceStatus)
  @Column({ type: 'varchar', length: 16, default: DeviceStatus.UNPROVISIONED })
  status: DeviceStatus;

  /** Conectado ahora mismo al broker (tiempo real posible). */
  @Field(() => Boolean)
  @Column({ type: 'boolean', default: false })
  connected: boolean;

  /** Última fuente de energía reportada: "usb" | "battery". */
  @Field(() => String, { nullable: true })
  @Column({ type: 'varchar', length: 16, nullable: true })
  power?: string | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt?: Date | null;

  /** Última telemetría en vivo (no las de la cola), tal como llegó. */
  @Field(() => GraphQLJSON, { nullable: true })
  @Column({ name: 'last_telemetry', type: 'jsonb', nullable: true })
  lastTelemetry?: Record<string, unknown> | null;

  /** Última respuesta a un comando (`.../ack`). */
  @Field(() => GraphQLJSON, { nullable: true })
  @Column({ name: 'last_ack', type: 'jsonb', nullable: true })
  lastAck?: Record<string, unknown> | null;

  @Field(() => GraphQLJSON)
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  config: DeviceConfig;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

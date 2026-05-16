import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  BeforeInsert,
} from 'typeorm';
import { ObjectType, Field, ID, Float, Int } from '@nestjs/graphql';

import { VehicleType }           from '../enums/vehicle-type.enum';
import { ParkingPaymentMethod }  from '../../visitor-parking/enums/parking-payment-method.enum';
import { ResidentialComplex }    from '../../residential-complex/entities/residential-complex.entity';
import { Unit }                  from '../../residential-complex/entities/unit.entity';
import { ParkingRecordStatus } from '../../visitor-parking/enums/parking-status.enum';

@ObjectType({ description: 'Registro de entrada/salida de vehículo visitante en el parqueadero' })
@Entity('parking_records')
@Index(['complexId', 'status'])
@Index(['plate'])
export class ParkingRecord {

  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ── Identificación ─────────────────────────────────────────────

  @Field(() => String, { description: 'Número de factura generado por el sistema (PKG-YYYYMMDD-XXXX)' })
  @Column({ name: 'invoice_number', type: 'varchar', length: 30, unique: true })
  invoiceNumber: string;

  // ── Datos del vehículo ─────────────────────────────────────────

  @Field(() => String, { description: 'Placa del vehículo (normalizada: mayúsculas, sin espacios)' })
  @Column({ type: 'varchar', length: 15 })
  plate: string;

  @Field(() => VehicleType, { description: 'Tipo de vehículo' })
  @Column({ name: 'vehicle_type', type: 'enum', enum: VehicleType, default: VehicleType.CAR })
  vehicleType: VehicleType;

  @Field(() => String, { description: 'Marca del vehículo', nullable: true })
  @Column({ type: 'varchar', length: 50, nullable: true })
  brand?: string;

  @Field(() => String, { description: 'Color del vehículo', nullable: true })
  @Column({ type: 'varchar', length: 50, nullable: true })
  color?: string;

  // ── Tiempos ────────────────────────────────────────────────────

  @Field(() => Date, { description: 'Fecha/hora de entrada (asignada por el servidor)' })
  @CreateDateColumn({ name: 'entry_date', type: 'timestamptz' })
  entryDate: Date;

  /** Alias de entryDate para compatibilidad con el patrón común de las entidades */
  @Field(() => Date, { description: 'Alias de entryDate' })
  get createdAt(): Date {
    return this.entryDate;
  }

  @Field(() => Date, { description: 'Fecha/hora de salida', nullable: true })
  @Column({ name: 'exit_date', type: 'timestamptz', nullable: true })
  exitDate?: Date;

  // ── Facturación ────────────────────────────────────────────────

  @Field(() => Int, { description: 'Duración en minutos (calculada en la salida)', nullable: true })
  @Column({ type: 'int', nullable: true })
  duration?: number;

  @Field(() => Float, { description: 'Tarifa unitaria aplicada', nullable: true })
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  rate?: number;

  @Field(() => Float, { description: 'Total cobrado', nullable: true })
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  total?: number;

  @Field(() => ParkingPaymentMethod, { description: 'Método de pago (disponible tras el cierre)', nullable: true })
  @Column({ name: 'payment_method', type: 'enum', enum: ParkingPaymentMethod, nullable: true })
  paymentMethod?: ParkingPaymentMethod;

  // ── Estado ─────────────────────────────────────────────────────

  @Field(() => ParkingRecordStatus, { description: 'Estado del registro' })
  @Column({ type: 'enum', enum: ParkingRecordStatus, default: ParkingRecordStatus.OPEN })
  status: ParkingRecordStatus;

  // ── Multi-tenant ───────────────────────────────────────────────

  @Field(() => String, { description: 'ID de la unidad visitada', nullable: true })
  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId?: string;

  @Field(() => String, { description: 'ID del complejo' })
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  // ── Auditoría ──────────────────────────────────────────────────

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // ── Relaciones ─────────────────────────────────────────────────

  @Field(() => Unit, { nullable: true })
  @ManyToOne(() => Unit, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'unit_id' })
  unit?: Unit;

  @Field(() => ResidentialComplex, { nullable: true })
  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;

  // ── Hooks ──────────────────────────────────────────────────────

  @BeforeInsert()
  normalizeFields() {
    if (this.plate) this.plate = this.plate.toUpperCase().replace(/[\s\-]/g, '');
    if (this.brand) this.brand = this.brand.trim().toUpperCase();
    if (this.color) this.color = this.color.trim().toUpperCase();
  }
}

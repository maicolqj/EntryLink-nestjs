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
  BeforeUpdate,
} from 'typeorm';
import { ObjectType, Field, Float } from '@nestjs/graphql';

import { ParkingStatus }     from '../enums/parking-status.enum';
import { VehicleType }       from '../../vehicles/enums/vehicle-type.enum';
import { Resident }          from '../../residents/entities/resident.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { User }               from '../../users/entities/user.entity';

@ObjectType({ description: 'Registro de vehículo visitante en el parqueadero' })
@Entity({ name: 'visitor_vehicles' })
@Index(['complexId', 'status'])
@Index(['complexId', 'entryTime'])
@Index(['hostResidentId', 'status'])
export class VisitorVehicle {

  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ==================== IDENTIFICACIÓN ====================

  @Field(() => String, { description: 'Placa del vehículo (normalizada: mayúsculas, sin espacios)' })
  @Column({ type: 'varchar', length: 20 })
  plate: string;

  @Field(() => VehicleType, { description: 'Tipo de vehículo' })
  @Column({ type: 'enum', enum: VehicleType })
  vehicleType: VehicleType;

  @Field(() => String, { description: 'Nombre del conductor', nullable: true })
  @Column({ name: 'driver_name', type: 'varchar', length: 200, nullable: true })
  driverName?: string;

  // ==================== TIEMPOS Y COSTO ====================

  @Field(() => Date, { description: 'Hora de ingreso al parqueadero' })
  @Column({ name: 'entry_time', type: 'timestamptz' })
  entryTime: Date;

  @Field(() => Date, { description: 'Hora de salida del parqueadero', nullable: true })
  @Column({ name: 'exit_time', type: 'timestamptz', nullable: true })
  exitTime?: Date;

  @Field(() => Float, { description: 'Costo total generado al momento de la salida', nullable: true })
  @Column({ name: 'parking_cost', type: 'decimal', precision: 10, scale: 2, nullable: true })
  parkingCost?: number;

  @Field(() => Float, { description: 'Tarifa por hora aplicada al momento de la salida', nullable: true })
  @Column({ name: 'rate_applied', type: 'decimal', precision: 10, scale: 2, nullable: true })
  rateApplied?: number;

  @Field(() => Number, { description: 'Minutos totales en el parqueadero', nullable: true })
  @Column({ name: 'minutes_parked', type: 'int', nullable: true })
  minutesParked?: number;

  // ==================== ESTADO ====================

  @Field(() => ParkingStatus, { description: 'Estado actual del registro' })
  @Column({ type: 'enum', enum: ParkingStatus, default: ParkingStatus.INSIDE })
  status: ParkingStatus;

  @Field(() => String, { description: 'Motivo de cancelación', nullable: true })
  @Column({ name: 'cancellation_reason', type: 'text', nullable: true })
  cancellationReason?: string;

  @Field(() => String, { description: 'Notas adicionales del registro', nullable: true })
  @Column({ type: 'text', nullable: true })
  notes?: string;

  // ==================== MULTI-TENANT ====================

  @Field(() => String, { description: 'ID del residente anfitrión' })
  @Column({ name: 'host_resident_id', type: 'uuid' })
  hostResidentId: string;

  @Field(() => String, { description: 'ID del complejo' })
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  // ==================== AUDITORÍA ====================

  @Field(() => String, { description: 'Usuario que registró el ingreso' })
  @Column({ name: 'registered_by_user_id', type: 'uuid' })
  registeredByUserId: string;

  @Field(() => String, { description: 'Usuario que registró la salida', nullable: true })
  @Column({ name: 'exit_registered_by_user_id', type: 'uuid', nullable: true })
  exitRegisteredByUserId?: string;

  @Field(() => String, { description: 'Usuario que canceló el registro', nullable: true })
  @Column({ name: 'cancelled_by_user_id', type: 'uuid', nullable: true })
  cancelledByUserId?: string;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // ==================== RELACIONES ====================

  @Field(() => Resident, { description: 'Residente anfitrión', nullable: true })
  @ManyToOne(() => Resident, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'host_resident_id' })
  hostResident?: Resident;

  @Field(() => ResidentialComplex, { nullable: true })
  @ManyToOne(() => ResidentialComplex, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;

  @Field(() => User, { description: 'Usuario que registró el ingreso', nullable: true })
  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'registered_by_user_id' })
  registeredByUser?: User;

  @Field(() => User, { description: 'Usuario que registró la salida', nullable: true })
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'exit_registered_by_user_id' })
  exitRegisteredByUser?: User;

  // ==================== HOOKS ====================

  @BeforeInsert()
  @BeforeUpdate()
  normalizeFields() {
    if (this.plate) {
      this.plate = this.plate.trim().toUpperCase().replace(/[\s\-]/g, '');
    }
    if (this.driverName) {
      this.driverName = this.driverName.trim().toUpperCase();
    }
  }
}

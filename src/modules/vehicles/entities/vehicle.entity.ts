import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  BeforeInsert,
  BeforeUpdate,
  Index,
} from 'typeorm';
import { ObjectType, Field, Int, Float } from '@nestjs/graphql';

import { VehicleType }     from '../enums/vehicle-type.enum';
import { VehicleStatus }   from '../enums/vehicle-status.enum';
import { VehicleFuelType } from '../enums/vehicle-fuel-type.enum';
import { Resident }        from '../../residents/entities/resident.entity';
import { Unit }            from '../../residential-complex/entities/unit.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { User }            from '../../users/entities/user.entity';

@ObjectType({ description: 'Vehículo de un residente registrado en el complejo' })
@Entity({ name: 'vehicles' })
// Una placa solo puede estar ACTIVA una vez en el mismo complejo
@Index(['complexId', 'plate'], {
  unique: true,
  where: `"status" NOT IN ('REMOVED', 'REJECTED') AND "deleted_at" IS NULL`,
})
@Index(['complexId', 'status'])
@Index(['residentId', 'status'])
@Index(['unitId', 'status'])
export class Vehicle {

  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ==================== IDENTIFICACIÓN DEL VEHÍCULO ====================

  @Field(() => String, { description: 'Placa del vehículo (normalizada: sin espacios, mayúsculas)' })
  @Column({ type: 'varchar', length: 15 })
  plate: string;

  @Field(() => VehicleType, { description: 'Tipo de vehículo' })
  @Column({ type: 'enum', enum: VehicleType, default: VehicleType.CAR })
  type: VehicleType;

  @Field(() => String, { description: 'Marca del vehículo. Ej: Toyota, Renault', nullable: true })
  @Column({ type: 'varchar', length: 50, nullable: true })
  brand?: string;

  @Field(() => String, { description: 'Modelo. Ej: Corolla, Logan', nullable: true })
  @Column({ type: 'varchar', length: 50, nullable: true })
  model?: string;

  @Field(() => Int, { description: 'Año del modelo', nullable: true })
  @Column({ type: 'smallint', nullable: true })
  year?: number;

  @Field(() => String, { description: 'Color del vehículo', nullable: true })
  @Column({ type: 'varchar', length: 50, nullable: true })
  color?: string;

  @Field(() => VehicleFuelType, { description: 'Tipo de combustible', nullable: true })
  @Column({ name: 'fuel_type', type: 'enum', enum: VehicleFuelType, nullable: true })
  fuelType?: VehicleFuelType;

  @Field(() => String, { description: 'URL de la foto del vehículo', nullable: true })
  @Column({ name: 'photo_url', type: 'text', nullable: true })
  photoUrl?: string;

  // ==================== PARQUEADERO ====================

  @Field(() => String, { description: 'Número o código del parqueadero asignado', nullable: true })
  @Column({ name: 'parking_spot', type: 'varchar', length: 20, nullable: true })
  parkingSpot?: string;

  // ==================== ESTADO Y APROBACIÓN ====================

  @Field(() => VehicleStatus, { description: 'Estado del vehículo en el complejo' })
  @Column({ type: 'enum', enum: VehicleStatus, default: VehicleStatus.PENDING_APPROVAL })
  status: VehicleStatus;

  @Field(() => Date, { description: 'Fecha de aprobación', nullable: true })
  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt?: Date;

  @Field(() => String, { description: 'Razón de rechazo o suspensión', nullable: true })
  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason?: string;

  @Field(() => String, { description: 'Notas internas del administrador', nullable: true })
  @Column({ type: 'text', nullable: true })
  notes?: string;

  // ==================== FKs — MULTI-TENANT ====================

  @Field(() => String, { description: 'ID del residente propietario del vehículo', nullable: true })
  @Column({ name: 'resident_id', type: 'uuid', nullable: true })
  residentId?: string;

  @Field(() => String, { description: 'ID de la unidad (desnormalizado de residente)' })
  @Column({ name: 'unit_id', type: 'uuid' })
  unitId: string;

  @Field(() => String, { description: 'ID del complejo (desnormalizado para multi-tenant)' })
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => String, { description: 'ID del usuario que aprobó o rechazó', nullable: true })
  @Column({ name: 'approved_by_user_id', type: 'uuid', nullable: true })
  approvedByUserId?: string;

  // ==================== ROTACIÓN DE PARQUEADEROS ====================

  /**
   * true cuando la suspensión actual fue originada por el sistema de rotación,
   * no por una acción manual del administrador. Permite distinguir ambos casos.
   */
  @Field(() => Boolean, {
    description: 'Indica si la suspensión actual fue generada por rotación automática de parqueaderos',
    defaultValue: false,
  })
  @Column({ name: 'suspended_by_rotation', type: 'boolean', default: false })
  suspendedByRotation: boolean;

  /** Fecha en que fue suspendido por rotación por última vez. Usado para la cola de equidad. */
  @Field(() => Date, {
    description: 'Última vez que fue suspendido por rotación (referencia de equidad)',
    nullable: true,
  })
  @Column({ name: 'rotation_suspended_at', type: 'timestamptz', nullable: true })
  rotationSuspendedAt?: Date;

  /**
   * Cantidad de veces que fue suspendido por rotación en el gran ciclo actual.
   * Se reinicia a 0 cuando todos los vehículos del mismo tipo han rotado al menos una vez.
   */
  @Field(() => Int, {
    description: 'Veces que ha salido por rotación en el gran ciclo actual (se reinicia al completar el ciclo)',
    defaultValue: 0,
  })
  @Column({ name: 'rotation_cycle_count', type: 'int', default: 0 })
  rotationCycleCount: number;

  // ==================== AUDITORÍA ====================

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date;

  // ==================== RELACIONES ====================

  @Field(() => Resident, { description: 'Residente propietario', nullable: true })
  @ManyToOne(() => Resident, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'resident_id' })
  resident?: Resident;

  @Field(() => Unit, { description: 'Unidad a la que pertenece', nullable: true })
  @ManyToOne(() => Unit, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'unit_id' })
  unit?: Unit;

  @Field(() => ResidentialComplex, { description: 'Complejo al que pertenece', nullable: true })
  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;

  @Field(() => User, { description: 'Usuario que aprobó/rechazó el vehículo', nullable: true })
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'approved_by_user_id' })
  approvedByUser?: User;

  // ==================== HOOKS ====================

  @BeforeInsert()
  @BeforeUpdate()
  normalizeFields() {
    // Normalizar placa: mayúsculas, sin espacios ni guiones
    if (this.plate) {
      this.plate = this.plate.toUpperCase().replace(/[\s\-]/g, '');
    }
    if (this.brand)  this.brand  = this.brand.trim().toUpperCase();
    if (this.model)  this.model  = this.model.trim().toUpperCase();
    if (this.color)  this.color  = this.color.trim().toUpperCase();
  }
}

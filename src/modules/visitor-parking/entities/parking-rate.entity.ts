import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, Float } from '@nestjs/graphql';

import { VehicleType }       from '../../vehicles/enums/vehicle-type.enum';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { User }               from '../../users/entities/user.entity';

@ObjectType({ description: 'Tarifa de parqueadero por tipo de vehículo' })
@Entity({ name: 'parking_rates' })
@Index(['complexId', 'vehicleType'], { unique: true })
export class ParkingRate {

  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ==================== TARIFA ====================

  @Field(() => VehicleType, { description: 'Tipo de vehículo al que aplica la tarifa' })
  @Column({ type: 'enum', enum: VehicleType })
  vehicleType: VehicleType;

  @Field(() => Float, { description: 'Tarifa por minuto (en moneda local)' })
  @Column({ name: 'rate_per_minute', type: 'decimal', precision: 10, scale: 2 })
  ratePerMinute: number;

  @Field(() => Boolean, { description: 'Indica si la tarifa está activa' })
  @Column({ name: 'is_active', default: true })
  isActive: boolean; 

  @Field(() => String, { description: 'Descripción o nombre de la tarifa', nullable: true })
  @Column({ type: 'varchar', length: 200, nullable: true })
  description?: string;

  // ==================== MULTI-TENANT ====================

  @Field(() => String, { description: 'ID del complejo al que pertenece la tarifa' })
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  // ==================== AUDITORÍA ====================

  @Field(() => String, { description: 'Usuario que creó la tarifa' })
  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string;

  @Field(() => String, { description: 'Usuario que actualizó la tarifa', nullable: true })
  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId?: string;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // ==================== RELACIONES ====================

  @Field(() => ResidentialComplex, { nullable: true })
  @ManyToOne(() => ResidentialComplex, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;

  @Field(() => User, { nullable: true })
  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser?: User;
}

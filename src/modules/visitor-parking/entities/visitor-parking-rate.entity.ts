import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { ObjectType, Field, Float, Int } from '@nestjs/graphql';

import { VisitorParkingConfig } from './visitor-parking-config.entity';
import { ParkingRateType } from '../enums/parking-rate-type.enum';
import { User } from '../../users/entities/user.entity';
import { VehicleType } from '../../vehicles/enums/vehicle-type.enum';

@ObjectType({ description: 'Tarifa de parqueadero para vehículos visitantes' })
@Entity({ name: 'visitor_parking_rates' })
export class VisitorParkingRate {

  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String, { description: 'Nombre descriptivo de la tarifa' })
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Field(() => String, { description: 'ID del complejo (para filtrado multi-tenant)', nullable: true })
  @Column({ name: 'complex_id', type: 'uuid', nullable: true })
  complexId?: string;

  @Field(() => ParkingRateType, { description: 'Tipo de tarifa aplicada' })
  @Column({ name: 'rate_type', type: 'enum', enum: ParkingRateType })
  type: ParkingRateType;

  @Field(() => VehicleType, { description: 'Tipo de vehículo' })
  @Column({ name: 'vehicle_type', type: 'enum', enum: VehicleType, default: VehicleType.CAR })
  vehicleType: VehicleType;

  @Field(() => Float, { description: 'Monto de la tarifa' })
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  @Field(() => Float, { description: 'Tope máximo de cobro por día', nullable: true })
  @Column({ name: 'max_daily_amount', type: 'decimal', precision: 12, scale: 2, nullable: true })
  maxDailyAmount?: number;

  @Field(() => Int, { description: 'Minutos de gracia sin cobro', nullable: true })
  @Column({ name: 'grace_period_minutes', type: 'int', nullable: true })
  gracePeriodMinutes?: number;

  @Field(() => String, { description: 'Moneda de la tarifa (ej. COP, USD)' })
  @Column({ type: 'varchar', length: 10 })
  currency: string;

  @Field(() => String, { nullable: true })
  @Column({ type: 'varchar', length: 300, nullable: true })
  description?: string;

  @Field(() => Boolean)
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'config_id', type: 'uuid' })
  configId: string;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => VisitorParkingConfig, (config) => config.rates, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'config_id' })
  config?: VisitorParkingConfig;



  @OneToMany(() => User, (user) => user.createVisitorParking)
  @Field(() => User)
  createdByUser: User

  @OneToMany(() => User, (user) => user.updateVisitorParking)
  @Field(() => User)
  updatedByUser: User


  
}

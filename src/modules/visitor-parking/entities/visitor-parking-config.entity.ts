import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { ObjectType, Field, Int, GraphQLISODateTime } from '@nestjs/graphql';

import { VisitorParkingRate } from './visitor-parking-rate.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';

@ObjectType({ description: 'Configuración del parqueadero para vehículos visitantes' })
@Entity({ name: 'visitor_parking_configs' })
export class VisitorParkingConfig {

  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String, { description: 'ID del complejo residencial' })
  @Column({ name: 'complex_id', type: 'uuid', unique: true })
  complexId: string;

  @Field(() => Int, { nullable: true, description: 'Capacidad máxima de vehículos visitantes simultáneos' })
  @Column({ name: 'max_capacity', type: 'int', nullable: true })
  maxCapacity?: number;

  @Field(() => Int, { nullable: true, description: 'Minutos de gracia antes de empezar a cobrar' })
  @Column({ name: 'grace_period_minutes', type: 'int', nullable: true })
  gracePeriodMinutes?: number;

  @Field(() => String, { nullable: true, description: 'Mensaje que aparece en el recibo de parqueadero' })
  @Column({ name: 'receipt_message', type: 'varchar', length: 500, nullable: true })
  receiptMessage?: string;

  @Field(() => Boolean, { description: 'Mostrar logo del complejo en el recibo' })
  @Column({ name: 'show_logo_on_receipt', type: 'boolean', nullable: true, default: false })
  showLogoOnReceipt: boolean;

  @Field(() => String, { nullable: true, description: 'ID de la tarifa activa por defecto' })
  @Column({ name: 'active_rate_id', type: 'uuid', nullable: true })
  activeRateId?: string;

  @Field(() => String, { description: 'Moneda principal del parqueadero (ej. COP, USD)' })
  @Column({ type: 'varchar', length: 10, nullable: true, default: 'COP' })
  currency: string;

  @Field(() => GraphQLISODateTime)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => GraphQLISODateTime)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Field(() => [VisitorParkingRate], { description: 'Tarifas configuradas para el parqueadero' })
  @OneToMany(() => VisitorParkingRate, (rate) => rate.config, { cascade: true, eager: false })
  rates: VisitorParkingRate[];

  @Field(() => ResidentialComplex, { nullable: true, description: 'Complejo residencial asociado a esta configuración' })
  @OneToOne(() => ResidentialComplex, (complex) => complex.visitorParkingConfig)
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;
}

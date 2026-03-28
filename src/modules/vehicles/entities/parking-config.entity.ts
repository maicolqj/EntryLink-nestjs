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
import { ObjectType, Field, ID, Float, Int } from '@nestjs/graphql';

import { ParkingRateType }       from '../enums/parking-rate-type.enum';
import { ResidentialComplex }    from '../../residential-complex/entities/residential-complex.entity';

@ObjectType({ description: 'Configuración de tarifas del parqueadero visitante por complejo' })
@Entity('parking_configs')
@Index(['complexId'], { unique: true })
export class ParkingConfig {

  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ── Tarifa ─────────────────────────────────────────────────────

  @Field(() => ParkingRateType, { description: 'Tipo de tarifa aplicada' })
  @Column({ name: 'rate_type', type: 'enum', enum: ParkingRateType })
  rateType: ParkingRateType;

  @Field(() => Float, { description: 'Valor unitario de la tarifa' })
  @Column({ name: 'rate_amount', type: 'decimal', precision: 12, scale: 2 })
  rateAmount: number;

  @Field(() => Int, { description: 'Minutos de gracia sin cobro', nullable: true })
  @Column({ name: 'grace_period_minutes', type: 'int', nullable: true })
  gracePeriodMinutes?: number;

  @Field(() => Float, { description: 'Tope máximo de cobro por día', nullable: true })
  @Column({ name: 'max_daily_amount', type: 'decimal', precision: 12, scale: 2, nullable: true })
  maxDailyAmount?: number;

  @Field(() => String, { description: 'Moneda (ISO 4217)', defaultValue: 'COP' })
  @Column({ type: 'varchar', length: 10, default: 'COP' })
  currency: string;

  // ── Multi-tenant ───────────────────────────────────────────────

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  // ── Auditoría ──────────────────────────────────────────────────

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // ── Relaciones ─────────────────────────────────────────────────

  @Field(() => ResidentialComplex, { nullable: true })
  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;
}

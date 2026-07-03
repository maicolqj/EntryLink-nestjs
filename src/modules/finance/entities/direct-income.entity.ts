import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, DeleteDateColumn,
  ManyToOne, Index,
} from 'typeorm';
import { ObjectType, Field, ID, Float } from '@nestjs/graphql';

import { IncomeCategory }     from '../enums/income-category.enum';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';

/**
 * Ingreso directo a caja/banco NO originado en una cuota de administración
 * (parqueadero, alquiler de salón, multas, rendimientos, etc.).
 * Espejo de ComplexExpense para el lado de los ingresos.
 */
@ObjectType()
@Entity('direct_incomes')
@Index(['complexId', 'period'])
@Index(['complexId', 'incomeDate'])
export class DirectIncome {

  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ─── Descripción y monto ──────────────────────────────────

  @Field()
  @Column({ length: 500 })
  description: string;

  @Field(() => Float)
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  @Field(() => IncomeCategory)
  @Column({ type: 'enum', enum: IncomeCategory })
  category: IncomeCategory;

  // ─── Período y fecha ──────────────────────────────────────

  /** Período contable en formato YYYY-MM (ej. "2025-03") */
  @Field()
  @Column({ length: 7 })
  period: string;

  /** Fecha real en que se recibió el ingreso */
  @Field(() => Date)
  @Column({ type: 'date' })
  incomeDate: Date;

  // ─── Soporte documental ───────────────────────────────────

  @Field({ nullable: true })
  @Column({ length: 2048, nullable: true })
  receiptUrl?: string;

  @Field({ nullable: true })
  @Column({ type: 'text', nullable: true })
  notes?: string;

  // ─── Reversión ────────────────────────────────────────────

  @Field()
  @Column({ default: false })
  isReversed: boolean;

  @Field({ nullable: true })
  @Column({ length: 500, nullable: true })
  reversalReason?: string;

  @Field(() => String, { nullable: true })
  @Column({ nullable: true })
  reversedByUserId?: string;

  @Field(() => Date, { nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  reversedAt?: Date;

  // ─── Multi-tenant y auditoría ─────────────────────────────

  @Field()
  @Column()
  complexId: string;

  @Field(() => String, { nullable: true })
  @Column({ nullable: true })
  registeredByUserId?: string;

  @Field()
  @CreateDateColumn()
  createdAt: Date;

  @Field()
  @UpdateDateColumn()
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  @DeleteDateColumn()
  deletedAt?: Date;

  // ─── Relaciones ───────────────────────────────────────────

  @Field(() => ResidentialComplex)
  @ManyToOne(() => ResidentialComplex, { eager: false })
  complex: ResidentialComplex;
}

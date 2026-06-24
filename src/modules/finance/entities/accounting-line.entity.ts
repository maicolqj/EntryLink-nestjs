import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { ObjectType, Field, ID, Float } from '@nestjs/graphql';

import { AccountingHeader } from './accounting-header.entity';
import { PucAccount } from './puc-account.entity';
import { Unit } from '../../residential-complex/entities/unit.entity';
import { moneyColumn } from '../utils/numeric.transformer';

/**
 * Renglón del asiento. Cada línea es DEBITO **o** CREDITO (la otra queda en 0).
 * `memo` = justificación contable específica de ESTE renglón (clave en egresos
 * para soportar a qué corresponde cada gasto).
 *
 * INMUTABLE igual que la cabecera.
 */
@ObjectType()
@Entity('accounting_lines')
@Index(['headerId'])
@Index(['complexId', 'pucAccountId'])
@Index(['complexId', 'unitId'])
export class AccountingLine {

  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column({ type: 'uuid' })
  headerId: string;

  @ManyToOne(() => AccountingHeader, (h) => h.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'headerId' })
  header: AccountingHeader;

  @Field()
  @Column({ type: 'uuid' })
  pucAccountId: string;

  @Field(() => PucAccount)
  @ManyToOne(() => PucAccount, { onDelete: 'RESTRICT', eager: false })
  @JoinColumn({ name: 'pucAccountId' })
  pucAccount: PucAccount;

  @Field(() => Float)
  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0, transformer: moneyColumn })
  debit: number;

  @Field(() => Float)
  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0, transformer: moneyColumn })
  credit: number;

  /** Justificación específica de la línea (a qué corresponde el movimiento). */
  @Field({ nullable: true })
  @Column({ type: 'text', nullable: true })
  memo?: string;

  // ─── Tenant / unidad (desnormalizado para reportes rápidos) ───

  @Field()
  @Column({ type: 'uuid' })
  complexId: string;

  @Field(() => String, { nullable: true })
  @Column({ type: 'uuid', nullable: true })
  unitId?: string | null;

  @ManyToOne(() => Unit, { nullable: true, onDelete: 'RESTRICT', eager: false })
  @JoinColumn({ name: 'unitId' })
  unit?: Unit | null;

  @Field()
  @CreateDateColumn()
  createdAt: Date;
}

import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, OneToMany, JoinColumn, Index,
} from 'typeorm';
import { ObjectType, Field, ID, Float, Int } from '@nestjs/graphql';

import { AccountingDocumentType } from '../enums/accounting-document-type.enum';
import { AccountingLine } from './accounting-line.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { Unit } from '../../residential-complex/entities/unit.entity';
import { moneyColumn } from '../utils/numeric.transformer';

/**
 * Cabecera de documento contable (asiento del libro diario).
 *
 * INMUTABLE: una vez asentado no se hace UPDATE/DELETE. Las correcciones se
 * realizan con un nuevo ACCOUNTING_NOTE de contra-asiento (reversesHeaderId
 * apunta al original; reversedByHeaderId se llena en el original al revertir).
 * La inmutabilidad se refuerza con un trigger BEFORE UPDATE/DELETE en BD.
 */
@ObjectType()
@Entity('accounting_headers')
@Index(['complexId', 'documentType', 'consecutive'], { unique: true })
@Index(['complexId', 'documentDate'])
@Index(['complexId', 'unitId'])
export class AccountingHeader {

  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => AccountingDocumentType)
  @Column({ type: 'enum', enum: AccountingDocumentType })
  documentType: AccountingDocumentType;

  /** Consecutivo legal por tipo de documento y copropiedad. */
  @Field(() => Int)
  @Column({ type: 'int' })
  consecutive: number;

  @Field(() => Date)
  @Column({ type: 'date' })
  documentDate: Date;

  /** Período contable YYYY-MM (cierres y reportes). */
  @Field()
  @Column({ type: 'varchar', length: 7 })
  period: string;

  /** Justificación a nivel de CABECERA del documento. */
  @Field({ nullable: true })
  @Column({ type: 'text', nullable: true })
  memo?: string;

  @Field(() => Float)
  @Column({ type: 'numeric', precision: 18, scale: 2, transformer: moneyColumn })
  totalDebit: number;

  @Field(() => Float)
  @Column({ type: 'numeric', precision: 18, scale: 2, transformer: moneyColumn })
  totalCredit: number;

  /** Tercero externo (proveedor). Texto libre o, a futuro, FK a proveedores. */
  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 200, nullable: true })
  thirdPartyName?: string;

  // ─── Contra-asientos (corrección sin mutar) ───────────────────

  @Field(() => String, { nullable: true })
  @Column({ type: 'uuid', nullable: true })
  reversesHeaderId?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'uuid', nullable: true })
  reversedByHeaderId?: string | null;

  // ─── Auditoría / tenant / unidad ──────────────────────────────

  /** Log estricto de quién asentó la transacción. */
  @Field()
  @Column({ type: 'uuid' })
  createdByUserId: string;

  @Field()
  @Column({ type: 'uuid' })
  complexId: string;

  /** Unidad afectada. Null en egresos puros a proveedor sin unidad imputable. */
  @Field(() => String, { nullable: true })
  @Column({ type: 'uuid', nullable: true })
  unitId?: string | null;

  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'complexId' })
  complex: ResidentialComplex;

  @ManyToOne(() => Unit, { nullable: true, onDelete: 'RESTRICT', eager: false })
  @JoinColumn({ name: 'unitId' })
  unit?: Unit | null;

  @Field(() => [AccountingLine])
  @OneToMany(() => AccountingLine, (l) => l.header, { cascade: ['insert'] })
  lines: AccountingLine[];

  @Field()
  @CreateDateColumn()
  createdAt: Date;
}

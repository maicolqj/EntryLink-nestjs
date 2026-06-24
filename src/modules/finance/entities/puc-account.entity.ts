import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, OneToMany, JoinColumn, Index,
} from 'typeorm';
import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

import { AccountNature, AccountClass } from '../enums/account-nature.enum';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';

/**
 * Plan Único de Cuentas. Árbol por copropiedad (tenant = complexId).
 * Solo las cuentas hoja (isPostable = true) admiten movimientos en AccountingLine;
 * las de agrupación (niveles superiores) sirven para totalizar.
 */
@ObjectType()
@Entity('puc_accounts')
@Index(['complexId', 'code'], { unique: true })
@Index(['complexId', 'isPostable'])
export class PucAccount {

  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Código PUC, ej "11100501" (banco). Único por copropiedad. */
  @Field()
  @Column({ type: 'varchar', length: 20 })
  code: string;

  @Field()
  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Field(() => AccountClass)
  @Column({ type: 'enum', enum: AccountClass })
  accountClass: AccountClass;

  @Field(() => AccountNature)
  @Column({ type: 'enum', enum: AccountNature })
  nature: AccountNature;

  /** Solo las hoja reciben asientos; las de agrupación no. */
  @Field()
  @Column({ type: 'boolean', default: true })
  isPostable: boolean;

  @Field()
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  /** Nivel en el árbol (1=clase, 2=grupo, 3=cuenta, ...). */
  @Field(() => Int)
  @Column({ type: 'int', default: 1 })
  level: number;

  // ─── Jerarquía ────────────────────────────────────────────────

  @Field(() => String, { nullable: true })
  @Column({ type: 'uuid', nullable: true })
  parentId: string | null;

  @ManyToOne(() => PucAccount, (a) => a.children, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'parentId' })
  parent: PucAccount | null;

  @Field(() => [PucAccount], { nullable: true })
  @OneToMany(() => PucAccount, (a) => a.parent)
  children: PucAccount[];

  // ─── Tenant ───────────────────────────────────────────────────

  @Field()
  @Column({ type: 'uuid' })
  complexId: string;

  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'complexId' })
  complex: ResidentialComplex;

  @Field()
  @CreateDateColumn()
  createdAt: Date;
}

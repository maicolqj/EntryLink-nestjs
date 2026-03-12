import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  BeforeInsert,
  BeforeUpdate,
  Index,
} from 'typeorm';
import { ObjectType, Field, Int } from '@nestjs/graphql';

import { ResidentialComplex } from './residential-complex.entity';
import { Unit }               from './unit.entity';

@ObjectType({ description: 'Torre o edificio dentro de un complejo' })
@Entity({ name: 'buildings' })
@Index(['complexId', 'code'], { unique: true, where: '"deleted_at" IS NULL' })
@Index(['complexId', 'status'])
export class Building {

  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ==================== IDENTIFICACIÓN ====================

  @Field(() => String, { description: 'Nombre de la torre/edificio. Ej: "Torre A"' })
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Field(() => String, { description: 'Código corto único dentro del complejo. Ej: "TA"' })
  @Column({ type: 'varchar', length: 10 })
  code: string;

  @Field(() => String, { description: 'Descripción opcional', nullable: true })
  @Column({ type: 'text', nullable: true })
  description?: string;

  // ==================== CARACTERÍSTICAS ====================

  @Field(() => Int, { description: 'Número total de pisos' })
  @Column({ type: 'int', default: 1 })
  floors: number;

  @Field(() => Boolean, { description: 'Estado activo/inactivo' })
  @Column({ type: 'boolean', default: true })
  status: boolean;

  // ==================== MULTI-TENANT ====================

  @Field(() => String, { description: 'ID del complejo al que pertenece' })
  @Column({ type: 'uuid', name: 'complex_id' })
  complexId: string;

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

  @Field(() => ResidentialComplex, { description: 'Complejo al que pertenece', nullable: true })
  @ManyToOne(() => ResidentialComplex, (complex) => complex.buildings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;

  @Field(() => [Unit], { description: 'Unidades dentro de esta torre', nullable: true })
  @OneToMany(() => Unit, (unit) => unit.building, { cascade: true })
  units?: Unit[];

  // ==================== HOOKS ====================

  @BeforeInsert()
  @BeforeUpdate()
  normalizeFields() {
    this.name = this.name?.trim().toUpperCase();
    this.code = this.code?.trim().toUpperCase();
  }
}

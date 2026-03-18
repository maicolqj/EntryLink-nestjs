import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  BeforeInsert,
  BeforeUpdate,
  Index,
} from 'typeorm';
import { ObjectType, Field, Int, Float } from '@nestjs/graphql';

import { UnitType }   from '../enums/unit-type.enum';
import { UnitStatus } from '../enums/unit-status.enum';
import { Building }   from './building.entity';
import { ResidentialComplex } from './residential-complex.entity';

@ObjectType({ description: 'Unidad habitable dentro de un edificio o complejo' })
@Entity({ name: 'units' })
@Index(['complexId', 'status'])
@Index(['buildingId', 'number'], { unique: true, where: '"deleted_at" IS NULL AND "buildingId" IS NOT NULL' })
@Index(['complexId', 'number'], { unique: true, where: '"deleted_at" IS NULL AND "buildingId" IS NULL' })
export class Unit {

  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ==================== IDENTIFICACIÓN ====================

  @Field(() => String, { description: 'Número o identificador de la unidad. Ej: "101", "B-202"' })
  @Column({ type: 'varchar', length: 20 })
  number: string;

  @Field(() => Int, { description: 'Piso en el que se ubica la unidad' })
  @Column({ type: 'int', default: 1 })
  floor: number;

  @Field(() => UnitType, { description: 'Tipo de unidad' })
  @Column({ type: 'enum', enum: UnitType, default: UnitType.APARTMENT })
  type: UnitType;

  @Field(() => UnitStatus, { description: 'Estado de disponibilidad' })
  @Column({ type: 'enum', enum: UnitStatus, default: UnitStatus.AVAILABLE })
  status: UnitStatus;

  // ==================== CARACTERÍSTICAS ====================

  @Field(() => Float, { description: 'Área en metros cuadrados', nullable: true })
  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  area?: number;

  @Field(() => Int, { description: 'Número de habitaciones', nullable: true })
  @Column({ type: 'smallint', nullable: true })
  bedrooms?: number;

  @Field(() => Int, { description: 'Número de baños', nullable: true })
  @Column({ type: 'smallint', nullable: true })
  bathrooms?: number;

  @Field(() => Int, { description: 'Cupos de parqueadero asignados' })
  @Column({ type: 'smallint', default: 0 })
  parkingSpots: number;

  @Field(() => Int, { description: 'Cuartos útiles o bodegas asignadas' })
  @Column({ type: 'smallint', default: 0 })
  storageRooms: number;

  @Field(() => String, { description: 'Descripción u observaciones adicionales', nullable: true })
  @Column({ type: 'text', nullable: true })
  description?: string;

  // ==================== MULTI-TENANT ====================

  @Field(() => String, { description: 'ID del complejo al que pertenece' })
  @Column({ type: 'uuid' })
  complexId: string;

  @Field(() => String, { description: 'ID de la torre/edificio (null si complejo sin torres)', nullable: true })
  @Column({ type: 'uuid', nullable: true })
  buildingId?: string;

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
  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE', nullable: false })
  complex?: ResidentialComplex;

  @Field(() => Building, { description: 'Torre o edificio contenedor', nullable: true })
  @ManyToOne(() => Building, (building) => building.units, { onDelete: 'SET NULL', nullable: true })
  building?: Building;

  // ==================== HOOKS ====================

  @BeforeInsert()
  @BeforeUpdate()
  normalizeFields() {
    this.number = this.number?.trim().toUpperCase();
  }
}

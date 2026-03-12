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
import GraphQLJSON from 'graphql-type-json';

import { ComplexType }   from '../enums/complex-type.enum';
import { ComplexPlan }   from '../enums/complex-plan.enum';
import { ComplexStatus } from '../enums/complex-status.enum';
import { User }          from '../../users/entities/user.entity';
import { Building }      from './building.entity';

@ObjectType({ description: 'Complejo residencial del sistema' })
@Entity({ name: 'residential_complexes' })
@Index(['status', 'plan'])
@Index(['slug'], { unique: true, where: '"deleted_at" IS NULL' })
@Index(['ownerId'])
export class ResidentialComplex {

  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ==================== IDENTIFICACIÓN ====================

  @Field(() => String, { description: 'Nombre del complejo' })
  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Field(() => String, { description: 'Slug único derivado del nombre' })
  @Column({ type: 'varchar', length: 170, unique: true })
  slug: string;

  @Field(() => String, { description: 'Descripción del complejo', nullable: true })
  @Column({ type: 'text', nullable: true })
  description?: string;

  // ==================== UBICACIÓN ====================

  @Field(() => String, { description: 'Dirección principal del complejo' })
  @Column({ type: 'varchar', length: 255 })
  address: string;

  @Field(() => String, { description: 'Ciudad' })
  @Column({ type: 'varchar', length: 100 })
  city: string;

  @Field(() => String, { description: 'Departamento o estado' })
  @Column({ type: 'varchar', length: 100 })
  state: string;

  @Field(() => String, { description: 'País' })
  @Column({ type: 'varchar', length: 100, default: 'Colombia' })
  country: string;

  @Field(() => String, { description: 'Código postal', nullable: true })
  @Column({ type: 'varchar', length: 20, nullable: true })
  zipCode?: string;

  // ==================== CLASIFICACIÓN ====================

  @Field(() => ComplexType, { description: 'Tipo de complejo residencial' })
  @Column({ type: 'enum', enum: ComplexType, default: ComplexType.APARTMENT_COMPLEX })
  type: ComplexType;

  @Field(() => ComplexPlan, { description: 'Plan de suscripción activo' })
  @Column({ type: 'enum', enum: ComplexPlan, default: ComplexPlan.FREE })
  plan: ComplexPlan;

  @Field(() => ComplexStatus, { description: 'Estado operativo del complejo' })
  @Column({ type: 'enum', enum: ComplexStatus, default: ComplexStatus.PENDING_SETUP })
  status: ComplexStatus;

  // ==================== CAPACIDAD ====================

  @Field(() => Int, { description: 'Máximo de unidades permitidas por el plan' })
  @Column({ type: 'int', default: 10 })
  maxUnits: number;

  // ==================== CONTACTO ====================

  @Field(() => String, { description: 'Teléfono de administración', nullable: true })
  @Column({ type: 'varchar', length: 20, nullable: true })
  phone?: string;

  @Field(() => String, { description: 'Email administrativo', nullable: true })
  @Column({ type: 'varchar', length: 100, nullable: true })
  email?: string;

  @Field(() => String, { description: 'Sitio web', nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  website?: string;

  // ==================== IDENTIDAD LEGAL ====================

  @Field(() => String, { description: 'NIT o identificación fiscal', nullable: true })
  @Column({ type: 'varchar', length: 30, nullable: true })
  nit?: string;

  @Field(() => String, { description: 'Nombre del representante legal', nullable: true })
  @Column({ type: 'varchar', length: 200, nullable: true })
  legalRepresentative?: string;

  // ==================== IMÁGENES ====================

  @Field(() => String, { description: 'URL del logo del complejo', nullable: true })
  @Column({ type: 'text', nullable: true })
  logoUrl?: string;

  @Field(() => String, { description: 'URL de imagen de portada', nullable: true })
  @Column({ type: 'text', nullable: true })
  coverUrl?: string;

  // ==================== CONFIGURACIÓN ====================

  @Field(() => GraphQLJSON, { description: 'Configuración avanzada del complejo', nullable: true })
  @Column({ type: 'jsonb', nullable: true, default: {} })
  settings?: Record<string, any>;

  // ==================== AUDITORÍA ====================

  @Field(() => String, { description: 'ID del propietario/administrador principal' })
  @Column({ type: 'uuid', name: 'owner_id', insert: false, update: false })
  ownerId: string;

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

  @Field(() => User, { description: 'Propietario/administrador principal', nullable: true })
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'owner_id' })
  owner?: User;

  @Field(() => [Building], { description: 'Torres o edificios del complejo', nullable: true })
  @OneToMany(() => Building, (building) => building.complex, { cascade: true })
  buildings?: Building[];

  // ==================== HOOKS ====================

  @BeforeInsert()
  @BeforeUpdate()
  normalizeFields() {
    this.name    = this.name?.trim();
    this.address = this.address?.trim();
    this.city    = this.city?.trim().toUpperCase();
    this.state   = this.state?.trim().toUpperCase();
    this.country = this.country?.trim();
    this.slug    = this.generateSlug(this.name);
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // quitar tildes
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .substring(0, 170);
  }
}

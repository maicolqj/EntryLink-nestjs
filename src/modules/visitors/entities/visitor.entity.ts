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
import { ObjectType, Field } from '@nestjs/graphql';

import { VisitorIdentityType } from '../enums/visitor-identity-type.enum';
import { ResidentialComplex }  from '../../residential-complex/entities/residential-complex.entity';
import { User }                from '../../users/entities/user.entity';
import { Visit }               from './visit.entity';

/**
 * Visitor representa a la PERSONA que visita.
 * Es reutilizable: la misma persona puede tener N visitas.
 * Scope: por complejo (no comparte registro entre complejos).
 */
@ObjectType({ description: 'Persona que realiza una o más visitas al complejo' })
@Entity({ name: 'visitors' })
@Index(['complexId', 'identity', 'identityType'], { unique: true, where: '"deleted_at" IS NULL' })
@Index(['complexId', 'isBlacklisted'])
@Index(['phone'])
export class Visitor {

  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ==================== DATOS PERSONALES ====================

  @Field(() => String, { description: 'Nombre del visitante' })
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Field(() => String, { description: 'Apellido del visitante' })
  @Column({ name: 'last_name', type: 'varchar', length: 100 })
  lastName: string;

  @Field(() => String, { description: 'Número de documento de identidad' })
  @Column({ type: 'varchar', length: 30 })
  identity: string;

  @Field(() => VisitorIdentityType, { description: 'Tipo de documento' })
  @Column({ name: 'identity_type', type: 'enum', enum: VisitorIdentityType, default: VisitorIdentityType.CC })
  identityType: VisitorIdentityType;

  @Field(() => String, { description: 'Teléfono de contacto', nullable: true })
  @Column({ type: 'varchar', length: 20, nullable: true })
  phone?: string;

  @Field(() => String, { description: 'URL de la foto capturada en portería', nullable: true })
  @Column({ name: 'photo_url', type: 'text', nullable: true })
  photoUrl?: string;

  // ==================== CONTROL DE ACCESO ====================

  @Field(() => Boolean, { description: 'Visitante en lista negra — no puede ingresar' })
  @Column({ name: 'is_blacklisted', type: 'boolean', default: false })
  isBlacklisted: boolean;

  @Field(() => String, { description: 'Razón del bloqueo', nullable: true })
  @Column({ name: 'blacklist_reason', type: 'text', nullable: true })
  blacklistReason?: string;

  @Field(() => Date, { description: 'Fecha en que fue bloqueado', nullable: true })
  @Column({ name: 'blacklisted_at', type: 'timestamptz', nullable: true })
  blacklistedAt?: Date;

  @Field(() => String, { description: 'ID del usuario que lo bloqueó', nullable: true })
  @Column({ name: 'blacklisted_by_user_id', type: 'uuid', nullable: true })
  blacklistedByUserId?: string;

  // ==================== MULTI-TENANT ====================

  @Field(() => String, { description: 'Complejo al que pertenece este registro' })
  @Column({ name: 'complex_id', type: 'uuid' })
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

  @Field(() => ResidentialComplex, { nullable: true })
  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;

  @Field(() => User, { description: 'Supervisor que lo bloqueó', nullable: true })
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'blacklisted_by_user_id' })
  blacklistedByUser?: User;

  @Field(() => [Visit], { description: 'Historial de visitas', nullable: true })
  @OneToMany(() => Visit, (visit) => visit.visitor)
  visits?: Visit[];

  // ==================== CAMPOS CALCULADOS ====================

  @Field(() => String, { description: 'Nombre completo del visitante' })
  get fullName(): string {
    return `${this.name} ${this.lastName}`.trim();
  }

  // ==================== HOOKS ====================

  @BeforeInsert()
  @BeforeUpdate()
  normalizeFields() {
    this.name     = this.name?.trim().toUpperCase();
    this.lastName = this.lastName?.trim().toUpperCase();
    this.identity = this.identity?.trim().toUpperCase();
    if (this.phone) this.phone = this.phone.replace(/\s+/g, '');
  }
}

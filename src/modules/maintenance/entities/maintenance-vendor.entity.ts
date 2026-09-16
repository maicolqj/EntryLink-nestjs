import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  BeforeInsert,
  BeforeUpdate,
} from 'typeorm';
import { ObjectType, Field, ID } from '@nestjs/graphql';

import { MaintenanceCategory } from '../enums/maintenance-category.enum';
import { textArrayTransformer } from '../utils/text-array.transformer';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';

/**
 * Proveedor externo de mantenimiento: el de los ascensores, el plomero, la
 * empresa de la bomba de agua.
 *
 * No es un usuario de la plataforma y no debe serlo: darle login a un tercero
 * significa darle acceso al conjunto —residentes, unidades, movimientos— para
 * que arregle una lámpara. Aquí es un registro al que se le asignan tickets y
 * del que queda historial; el contacto se hace por fuera, como hoy.
 */
@ObjectType({ description: 'Proveedor externo de mantenimiento' })
@Entity({ name: 'maintenance_vendors' })
@Index(['complexId', 'isActive'])
export class MaintenanceVendor {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String)
  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Field(() => String, { description: 'NIT o cédula', nullable: true })
  @Column({ name: 'legal_id', type: 'varchar', length: 30, nullable: true })
  legalId?: string | null;

  @Field(() => String, { nullable: true })
  @Column({
    name: 'contact_name',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  contactName?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'varchar', length: 30, nullable: true })
  phone?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'varchar', length: 150, nullable: true })
  email?: string | null;

  /**
   * Oficios que atiende. La asignación no lo exige —a las 2 a.m. se llama a
   * quien conteste—, pero sí ordena la lista que ve el administrador.
   */
  @Field(() => [MaintenanceCategory], { nullable: true })
  @Column({
    type: 'text',
    array: true,
    nullable: true,
    default: [],
    transformer: textArrayTransformer,
  })
  specialties: MaintenanceCategory[];

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Field(() => Boolean)
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => String, { nullable: true })
  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string | null;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;

  @Field(() => ResidentialComplex, { nullable: true })
  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;

  @BeforeInsert()
  @BeforeUpdate()
  normalize(): void {
    this.name = this.name?.trim();
    this.email = this.email?.trim().toLowerCase() || null;
    this.legalId = this.legalId?.replace(/[\s.-]/g, '') || null;
    this.phone = this.phone?.trim() || null;
  }
}

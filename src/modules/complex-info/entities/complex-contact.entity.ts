import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  BeforeInsert,
  BeforeUpdate,
} from 'typeorm';
import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

import { ComplexContactCategory } from '../enums/complex-info.enums';

/**
 * Un contacto del directorio del conjunto: la administradora, la portería, el
 * presidente del consejo, la empresa de ascensores… Con horario, porque lo que
 * más pregunta el residente es "¿a qué hora atienden?".
 */
@ObjectType({ description: 'Contacto del directorio del conjunto' })
@Entity('complex_contacts')
@Index(['complexId'])
export class ComplexContact {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => ComplexContactCategory)
  @Column({
    type: 'enum',
    enum: ComplexContactCategory,
    enumName: 'complex_contact_category',
  })
  category: ComplexContactCategory;

  @Field({ description: 'Nombre. Ej: "Administración", "Ascensores Andino"' })
  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Field(() => String, {
    nullable: true,
    description:
      'Cargo o qué atiende. Ej: "Administradora", "Portería torre 2"',
  })
  @Column({ type: 'varchar', length: 150, nullable: true })
  role?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'varchar', length: 30, nullable: true })
  phone?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'varchar', length: 150, nullable: true })
  email?: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'Horario. Ej: "Lun a vie 8:00 a. m. – 5:00 p. m."',
  })
  @Column({ type: 'varchar', length: 200, nullable: true })
  schedule?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Field(() => Int, { description: 'Orden dentro de su sección' })
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Field({ description: 'Visible para los residentes' })
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt?: Date | null;

  @BeforeInsert()
  @BeforeUpdate()
  normalize() {
    const clean = (v?: string | null) =>
      v === undefined ? undefined : v === null ? null : v.trim() || null;
    if (this.name) this.name = this.name.trim().replace(/\s+/g, ' ');
    this.role = clean(this.role);
    this.phone = clean(this.phone)?.replace(/\s+/g, ' ') ?? this.phone;
    this.email = clean(this.email)?.toLowerCase() ?? this.email;
    this.schedule = clean(this.schedule);
    this.notes = clean(this.notes);
  }
}

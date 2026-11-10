import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Field, Int, ObjectType } from '@nestjs/graphql';

import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';

/**
 * Una portería del conjunto (ej. "PORTERÍA NORTE", "PORTERÍA VEHICULAR").
 *
 * Existe para que el residente elija a cuál se dirige —pedir que le devuelvan
 * la llamada, llamar por internet— y solo esa se entere. El vigilante dice en
 * EntryLink en cuál está (`security_post_guards`).
 *
 * Un conjunto sin porterías creadas tiene una sola, implícita: todo le llega a
 * todo el personal de portería, como siempre.
 */
@ObjectType({ description: 'Portería del conjunto' })
@Entity({ name: 'security_posts' })
@Index('UQ_security_posts_complex_name', ['complexId', 'name'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class SecurityPost {
  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => String, { description: 'Nombre que ve el residente' })
  @Column({ type: 'varchar', length: 80 })
  name: string;

  /**
   * Línea del celular de esa portería. Opcional: para que el residente la
   * marque directo cuando la citofonía es por SIM.
   */
  @Field(() => String, { nullable: true })
  @Column({ name: 'phone_number', type: 'varchar', length: 30, nullable: true })
  phoneNumber: string | null;

  @Field(() => Int, { description: 'Orden en la lista (ascendente)' })
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Field(() => Boolean, {
    description: 'Inactiva: no aparece para elegir ni recibe nada',
  })
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId: string | null;

  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;

  @BeforeInsert()
  @BeforeUpdate()
  normalize() {
    this.name = this.name?.trim().replace(/\s+/g, ' ').toUpperCase();
    this.phoneNumber = this.phoneNumber?.replace(/\s+/g, '') || null;
  }
}

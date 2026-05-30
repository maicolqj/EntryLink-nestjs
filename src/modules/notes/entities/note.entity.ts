import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field } from '@nestjs/graphql';

import { User }               from '../../users/entities/user.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';

/**
 * Note representa una nota/minuta operativa inmutable dentro de un complejo
 * residencial. Solo puede ser creada por SECURITY_ROL y SUPERVISOR_ROL.
 * Solo puede ser eliminada (soft delete) por SUPER_ADMIN_ROL.
 */
@ObjectType({ description: 'Nota/minuta operativa del complejo residencial' })
@Entity({ name: 'notes' })
@Index(['complexId', 'createdAt'])
@Index(['complexId', 'createdByUserId'])
export class Note {

  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ==================== CONTENIDO ====================

  @Field(() => String, { description: 'Título de la nota' })
  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Field(() => String, { description: 'Cuerpo de la nota' })
  @Column({ type: 'text' })
  content: string;

  @Field(() => [String], { description: 'URLs de imágenes adjuntas (R2)', nullable: true })
  @Column({
    name: 'image_urls',
    type: 'text',
    array: true,
    nullable: true,
    default: [],
    transformer: {
      to: (value: string[] | null) => value ?? [],
      from: (value: any): string[] => {
        if (!value) return [];
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') {
          const stripped = value.replace(/^\{|\}$/g, '');
          if (!stripped) return [];
          return stripped.split(',').map(s => s.replace(/^"|"$/g, '').trim()).filter(Boolean);
        }
        return [];
      },
    },
  })
  imageUrls: string[];

  // ==================== FKs (MULTI-TENANT) ====================

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => String, { nullable: true })
  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string;

  @Field(() => String, { nullable: true, description: 'Rol del creador al momento de registrar la nota' })
  @Column({ name: 'created_by_role', type: 'varchar', length: 50, nullable: true })
  createdByRole: string | null;

  @Field(() => String, { nullable: true, description: 'ID de la visita activa del supervisor bajo la cual se creó esta nota' })
  @Column({ name: 'supervisor_visit_id', type: 'uuid', nullable: true })
  supervisorVisitId?: string;

  // ==================== AUDITORÍA ====================

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date, { nullable: true, description: 'Fecha de eliminación lógica (solo SUPER_ADMIN)' })
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date;

  // ==================== RELACIONES ====================

  @Field(() => ResidentialComplex, { nullable: true })
  @ManyToOne(() => ResidentialComplex, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;

  @Field(() => User, { description: 'Usuario que creó la nota', nullable: true })
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser?: User;
}

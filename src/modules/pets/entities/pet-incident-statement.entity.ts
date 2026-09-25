import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field } from '@nestjs/graphql';

import { PetIncident } from './pet-incident.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Descargo: lo que la unidad señalada responde antes de que la administración
 * sancione.
 *
 * Es la pieza que hace defendible una multa. La Ley 675 (art. 59) exige darle
 * al implicado la oportunidad de ser oído antes de imponerle una sanción; sin
 * este registro, una multa por mascotas se cae ante cualquier reclamo.
 *
 * Inmutable, como el reporte: se agrega, no se edita.
 */
@ObjectType({ description: 'Descargo de la unidad ante un reporte' })
@Entity({ name: 'pet_incident_statements' })
@Index(['incidentId'])
export class PetIncidentStatement {
  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String)
  @Column({ name: 'incident_id', type: 'uuid' })
  incidentId: string;

  @Field(() => String, { description: 'Texto del descargo' })
  @Column({ type: 'text' })
  text: string;

  @Field(() => [String], {
    description: 'Soportes adjuntos (R2)',
    nullable: true,
  })
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
        if (Array.isArray(value)) return value as string[];
        if (typeof value === 'string') {
          const stripped = value.replace(/^\{|\}$/g, '');
          if (!stripped) return [];
          return stripped
            .split(',')
            .map((s) => s.replace(/^"|"$/g, '').trim())
            .filter(Boolean);
        }
        return [];
      },
    },
  })
  imageUrls: string[];

  /**
   * Descargo de la unidad señalada (true) u observación de la administración
   * (false). Solo los descargos cierran el plazo de defensa.
   */
  @Field(() => Boolean, { defaultValue: false })
  @Column({ name: 'is_defense', type: 'boolean', default: false })
  isDefense: boolean;

  @Field(() => String, { nullable: true })
  @Column({ name: 'author_user_id', type: 'uuid', nullable: true })
  authorUserId?: string | null;

  @Field(() => String, {
    description: 'Rol de quien responde, congelado al momento del descargo',
    nullable: true,
  })
  @Column({ name: 'author_role', type: 'varchar', length: 50, nullable: true })
  authorRole?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'author_name', type: 'varchar', length: 200, nullable: true })
  authorName?: string | null;

  @Field(() => String)
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => PetIncident, { nullable: true })
  @ManyToOne(() => PetIncident, (incident) => incident.statements, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'incident_id' })
  incident?: PetIncident;

  @Field(() => User, { nullable: true })
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'author_user_id' })
  author?: User;
}

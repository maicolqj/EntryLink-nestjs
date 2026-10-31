import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { GrowthTeamMemberStatus } from '../../shared/growth.enums';

/**
 * Integrante del equipo comercial. La identidad (login, roles, excepciones de
 * permisos) vive en `public.users`; aquí solo lo comercial. Nunca se borra:
 * hay historial que lo referencia, se desactiva con `leftAt`.
 */
@ObjectType('GrowthTeamMember')
@Entity({ schema: 'growth', name: 'team_members' })
export class TeamMember {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => ID, { description: 'Usuario de la plataforma (users.id)' })
  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  @Field()
  @Column({ name: 'display_name', type: 'varchar', length: 120 })
  displayName: string;

  @Field({ nullable: true })
  @Column({ name: 'job_title', type: 'varchar', length: 80, nullable: true })
  jobTitle?: string | null;

  @Field(() => GrowthTeamMemberStatus)
  @Column({
    type: 'varchar',
    length: 20,
    default: GrowthTeamMemberStatus.ACTIVE,
  })
  status: GrowthTeamMemberStatus;

  @Field(() => [String], { description: 'Localidades de Bogotá a cargo' })
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  territories: string[];

  @Field(() => Int, { nullable: true })
  @Column({ name: 'max_active_assignments', type: 'int', nullable: true })
  maxActiveAssignments?: number | null;

  @Field()
  @Column({ name: 'joined_at', type: 'timestamptz', default: () => 'now()' })
  joinedAt: Date;

  @Field({ nullable: true })
  @Column({ name: 'left_at', type: 'timestamptz', nullable: true })
  leftAt?: Date | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string | null;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId?: string | null;
}

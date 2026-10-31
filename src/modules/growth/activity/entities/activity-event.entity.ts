import { Field, ID, ObjectType } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { GrowthEntityType } from '../../shared/growth.enums';

/**
 * Registro de actividad de la suite. Append-only en dos niveles: el servicio
 * solo inserta y un trigger de Postgres rechaza UPDATE, DELETE y TRUNCATE.
 *
 * `changes` no lleva datos personales en claro: ver `ActivityLogService`.
 */
@ObjectType('GrowthActivityEvent')
@Entity({ schema: 'growth', name: 'activity_events' })
export class ActivityEvent {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId?: string | null;

  @Field(() => [String])
  @Column({
    name: 'actor_roles',
    type: 'text',
    array: true,
    default: () => "'{}'",
  })
  actorRoles: string[];

  @Field()
  @Column({ type: 'varchar', length: 60 })
  action: string;

  @Field(() => GrowthEntityType)
  @Column({ name: 'entity_type', type: 'varchar', length: 40 })
  entityType: GrowthEntityType;

  @Field(() => ID)
  @Column({ name: 'entity_id', type: 'uuid' })
  entityId: string;

  @Field(() => GraphQLJSON, { nullable: true })
  @Column({ type: 'jsonb', nullable: true })
  changes?: Record<string, unknown> | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

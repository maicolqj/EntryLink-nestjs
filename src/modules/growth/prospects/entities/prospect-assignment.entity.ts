import { Field, ID, ObjectType } from '@nestjs/graphql';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Responsable de un prospecto, con historial: reasignar cierra la fila vigente
 * y abre otra. La base permite un solo responsable vigente por prospecto.
 */
@ObjectType('GrowthProspectAssignment')
@Entity({ schema: 'growth', name: 'prospect_assignments' })
export class ProspectAssignment {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'person_id', type: 'uuid', nullable: true })
  personId?: string | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'property_id', type: 'uuid', nullable: true })
  propertyId?: string | null;

  @Field(() => ID)
  @Column({ name: 'team_member_id', type: 'uuid' })
  teamMemberId: string;

  @Field(() => ID)
  @Column({ name: 'assigned_by_user_id', type: 'uuid' })
  assignedByUserId: string;

  @Field({ nullable: true })
  @Column({ type: 'text', nullable: true })
  reason?: string | null;

  @Field()
  @Column({ name: 'started_at', type: 'timestamptz', default: () => 'now()' })
  startedAt: Date;

  @Field({ nullable: true })
  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt?: Date | null;

  @Field(() => ID, { nullable: true })
  @Column({ name: 'ended_by_user_id', type: 'uuid', nullable: true })
  endedByUserId?: string | null;
}

import { Field, Int, ObjectType } from '@nestjs/graphql';
import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Configuración de la suite (fila única, no se borra). */
@ObjectType('GrowthSettings')
@Entity({ schema: 'growth', name: 'settings' })
export class GrowthSettings {
  @PrimaryColumn({ type: 'smallint', default: 1 })
  id: number;

  @Field({
    description:
      'Excepción a la separación de funciones: SUPER_ADMIN puede validar lo que registró. Queda en auditoría.',
  })
  @Column({
    name: 'allow_super_admin_self_validation',
    type: 'boolean',
    default: true,
  })
  allowSuperAdminSelfValidation: boolean;

  @Field(() => Int)
  @Column({ name: 'prospect_goal', type: 'int', default: 100 })
  prospectGoal: number;

  @Field()
  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId?: string | null;
}

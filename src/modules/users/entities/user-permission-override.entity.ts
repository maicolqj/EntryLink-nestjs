import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field } from '@nestjs/graphql';

import { User } from './user.entity';
import { Permission } from '../../permissions/entities/permission.entity';
import { PermissionOverrideEffect } from '../enums/permission-override-effect.enum';

/**
 * Excepción de un permiso para UN usuario, por encima de sus roles.
 *
 * Los permisos de alguien salen de sus roles; esto cubre al contador que no
 * debe anular cargos o al supervisor que necesita un permiso suelto sin
 * inventar un rol nuevo. Se aplica al emitir el access token: permisos de sus
 * roles + GRANT − DENY. Un GRANT no aplica en una sesión acotada a residente,
 * que no puede ganar privilegios por el canal por el que entró.
 *
 * Una fila por usuario y permiso: cambiar de GRANT a DENY reemplaza la fila.
 */
@ObjectType({
  description: 'Permiso dado o quitado a un usuario por encima de sus roles',
})
@Entity({ name: 'user_permission_overrides' })
@Index(
  'UQ_user_permission_overrides_user_permission',
  ['userId', 'permissionId'],
  {
    unique: true,
  },
)
export class UserPermissionOverride {
  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => String)
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Field(() => String)
  @Column({ name: 'permission_id', type: 'uuid' })
  permissionId: string;

  @Field(() => PermissionOverrideEffect)
  @Column({
    type: 'enum',
    enum: PermissionOverrideEffect,
    enumName: 'permission_override_effect',
  })
  effect: PermissionOverrideEffect;

  @Field(() => String, {
    nullable: true,
    description: 'Por qué se dio o se quitó, para quien lo revise después',
  })
  @Column({ type: 'text', nullable: true })
  reason?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById?: string | null;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Field(() => Permission)
  @ManyToOne(() => Permission, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'permission_id' })
  permission: Permission;
}

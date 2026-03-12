import { ObjectType, Field, ID, registerEnumType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  BeforeInsert,
  BeforeUpdate,
  OneToMany
} from 'typeorm';
import { ValidPermissions } from '../enums/valid-permissions';
import { PermissionLevel } from '../enums/level-permissions';
import { Role } from '../../roles/entities/role.entity';
import { User } from '../../users/entities/user.entity';

registerEnumType(ValidPermissions, { name: 'ValidPermissions' });
registerEnumType(PermissionLevel, { name: 'PermissionLevel' });

@ObjectType({ description: 'Permiso del sistema granular.' })
@Entity({ name: 'permissions' })
// Índices compuestos para optimizar las búsquedas del Guard de seguridad
@Index(['name', 'status'])
@Index(['group', 'status'])
export class Permission {

  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field(() => ValidPermissions)
  @Column({
    type: 'enum',
    enum: ValidPermissions,
    unique: true // Un permiso no puede repetirse
  })
  name: ValidPermissions;

  @Field({ description: 'Nombre legible (ej: CREAR_USUARIO)' })
  @Column({ type: 'varchar', length: 100, nullable: false }) // Aseguramos que no sea null a nivel DB
  label: string;

  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  description?: string;

  @Field({ description: 'Categoría (ej: AUTH, USERS, BILLING)' })
  @Column({ type: 'varchar', length: 50 })
  group: string;

  @Field({ description: 'Define si el permiso es crítico o informativo' })
  @Column({
    type: 'enum',
    enum: PermissionLevel,
    default: PermissionLevel.LOW
  })
  level: PermissionLevel;

  @Field()
  @Column({ type: 'boolean', default: false })
  isSystem: boolean;

  @Field()
  @Column({ type: 'boolean', default: true })
  status: boolean;

  // --- TRAZABILIDAD Y AUDIT ---

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Field({ nullable: true, description: 'Usuario que creó el registro' })
  @Column({ name: 'created_by', nullable: true })
  createdBy?: string;

  // --- RELACIONES AUTO-REFERENCIADAS ---

  @Field(() => [Permission], { nullable: 'itemsAndList' })
  @ManyToMany(() => Permission, (permission) => permission.dependsOn)
  dependentPermissions?: Permission[];

  @Field(() => [Permission], { nullable: 'itemsAndList' })
  @ManyToMany(() => Permission, (permission) => permission.dependentPermissions)
  @JoinTable({
    name: 'permission_dependencies',
    joinColumn: { name: 'permission_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'depends_on_id', referencedColumnName: 'id' },
  })
  dependsOn?: Permission[];


  @ManyToMany(() => Role, role => role.permissions)
  roles: Role[];

  @OneToMany(() => User, (user) => user.createdPermissions)
  @Field(() => User)
  createdByUser?: User;

  @OneToMany(() => User, (user) => user.updatedPermissions)
  @Field(() => User)
  updatedByUser?: User;

  // --- HELPERS DE VALIDACIÓN ---

  @BeforeInsert()
  @BeforeUpdate()
  validateLabel() {
    // Forzamos que el label siempre llegue en mayúsculas antes de persistir
    if (this.label) {
      this.label = this.label.toUpperCase().trim();
    }
  }
}
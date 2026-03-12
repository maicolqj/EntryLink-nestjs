import { ObjectType, Field, registerEnumType, Int } from "@nestjs/graphql";
import GraphQLJSON from "graphql-type-json";

import { Entity, Index, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, ManyToMany, JoinTable, CreateDateColumn, UpdateDateColumn, JoinColumn, BeforeInsert, BeforeUpdate } from "typeorm";

import { IsEnum } from "class-validator";
import { SimpleRoleResponse } from "../dto/responses";
import { Permission } from "../../permissions/entities/permission.entity";
import { ValidRoles } from "../enums/valid-roles";
import { UserRole } from "../../users/entities/user_has_roles.entity";
import { User } from "../../users/entities/user.entity";




@ObjectType()
@Entity('roles')
@Index(['name', 'frontName'])
@Index(['status', ])
export class Role {

  @PrimaryGeneratedColumn('uuid')
  @Field(() => String, { description: 'id of the role' })
  id: string;

  @Column({ type: 'enum', enum: ValidRoles, default: ValidRoles.RESIDENT_ROL })
  @IsEnum(ValidRoles)
  @Field(() => ValidRoles, { description: 'name of the role', defaultValue: ValidRoles.RESIDENT_ROL})
  name: ValidRoles;

  @Column({ length: 100 })
  @Field(() => String, { description: 'name of the role' })
  frontName: string;

  @Column({ nullable: false })
  @Field(() => String, { description: 'icon of the role that will be visible in the frontend ', nullable: false })
  icon: string;

  @Column({ type: 'text', nullable: true })
  @Field(() => String, { description: 'description of the role', nullable: true })
  description: string;

  @Column({ type: 'int', default: 4 })
  @Field(() => Int, {
    description: 'Hierarchy level (0=highest, 1=second, 2=third, 3=fourth, 4=lowest)'
  })
  hierarchyLevel: number;

  @Column({ default: true })
  @Field(() => Boolean, { description: 'indicates if role is active' })
  status: boolean;

  @Column({ default: false })
  @Field(() => Boolean, { description: 'indicates if role is system role' })
  isSystem: boolean;

  @Column({ type: 'jsonb', nullable: true, default: {} }) // Almacena reglas dinámicas
  @Field(() => GraphQLJSON, {
    description: 'Stores dynamic rules.',
    nullable: true,
  })
  metadata?: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  @Field(() => Date)
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  @Field(() => Date)
  updatedAt: Date;


  //**************************************************************************************************************************
  //**************************************************************************************************************************
  //*************************************************************RELACIONES***************************************************
  //**************************************************************************************************************************
  //**************************************************************************************************************************


  // Jerarquía de roles
  @ManyToOne(() => Role, role => role.children, { nullable: true })
  @Field(() => Role, { description: 'parent role for hierarchy', nullable: true })
  parent: Role;

  @OneToMany(() => Role, role => role.parent)
  @Field(() => [SimpleRoleResponse], { description: 'child roles in hierarchy', nullable: true })
  children?: SimpleRoleResponse[];

  // Relación Many-to-Many con permisos (manteniendo restricción de negocio)
  @ManyToMany(() => Permission, permission => permission.roles, {
    cascade: ['insert', 'update'],
  })
  @JoinTable({
    name: 'role_permissions',
    joinColumn: {
      name: 'role_id',
      referencedColumnName: 'id',
    },
    inverseJoinColumn: {
      name: 'permission_id',
      referencedColumnName: 'id',
    },
  })
  @Field(() => [Permission], { description: 'permissions assigned to this role', nullable: true })
  permissions: Permission[];

  @OneToMany(() => UserRole, userRole => userRole.role)
  @Field(() => [UserRole], { nullable: true })
  userRoles: UserRole[];

  @ManyToOne(() => User, (user) => user.createdRoles, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'createdBy' })
  @Field(() => User, { nullable: true })
  createdByUser?: User;

  @ManyToOne(() => User, (user) => user.updatedRoles, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updatedBy' })
  @Field(() => User, { nullable: true })
  updatedByUser?: User;

  
    //**************************************************************************************************************************
    //**************************************************************************************************************************
    //*************************************************************HOOKS***************************************************
    //**************************************************************************************************************************
    //**************************************************************************************************************************
  
  
    @BeforeInsert()
    async beforeInsert() {
      await this.normalizeFields();
    }
  
    @BeforeUpdate()
    async beforeUpdate() {
      await this.normalizeFields();
      this.updatedAt = new Date();
    }
  
    private async normalizeFields() {
      // this.name = this.name?.toUpperCase().trim();
      this.description = this.description?.toUpperCase().trim();
      this.frontName = this.frontName?.toUpperCase().trim();

    }
  
}
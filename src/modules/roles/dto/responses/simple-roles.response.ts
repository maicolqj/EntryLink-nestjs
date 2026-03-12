import { ObjectType, Field, Int } from "@nestjs/graphql";

import { Role } from "../../entities/role.entity";
import GraphQLJSON from "graphql-type-json";
import { ValidRoles } from "../../enums/valid-roles";
import { SimplePermissionResponse } from "../../../permissions/dto/responses/simple-permission.response";
import { UserRole } from "../../../users/entities/user_has_roles.entity";
import { User } from "../../../users/entities/user.entity";


@ObjectType()
export class SimpleRoleResponse {

  @Field(() => String, { description: 'id of the role' })
  id: string;

  @Field(() => ValidRoles, { description: 'name of the role', nullable: true })
  name?: ValidRoles;

  @Field(() => String, { description: 'name of the role', nullable: true })
  frontName?: string;

  @Field(() => String, { description: 'description of the role', nullable: true })
  description?: string;


  @Field(() => String, { description: 'icon of the role', nullable: true })
  icon?: string;

  @Field(() => Int, {
    description: 'Hierarchy level (0=highest, 1=second, 2=third, 3=fourth, 4=lowest)',
    nullable: true
  })
  hierarchyLevel?: number;

  @Field(() => Boolean, {
    description: 'indicates if role is active',
    nullable: true
  })
  status?: boolean;


  @Field(() => Boolean, {
    description: 'indicates if role is system role',
    nullable: true
  })
  isSystem?: boolean;

  @Field(() => GraphQLJSON, {
    description: 'Stores dynamic rules.',
    nullable: true,
  })
  metadata?: Record<string, any>;

  @Field(() => Date, { nullable: true })
  createdAt?: Date;

  @Field(() => Date, { nullable: true })
  updatedAt?: Date;

  @Field(() => [SimplePermissionResponse], { description: 'permissions assigned to this role', nullable: true })
  permissions?: SimplePermissionResponse[];


  @Field(() => SimpleRoleResponse, { description: 'parent role for hierarchy', nullable: true })
  parent?: SimpleRoleResponse;

  @Field(() => [SimpleRoleResponse], { description: 'child roles in hierarchy', nullable: true })
  children?: SimpleRoleResponse[];

  @Field(() => [UserRole], { nullable: true })
  userRoles?: UserRole[];

  @Field(() => User, { nullable: true })
  createdByUser?: User;

  @Field(() => User, { nullable: true })
  updatedByUser?: User;

}
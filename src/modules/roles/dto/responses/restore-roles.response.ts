import { ObjectType, Field, Int } from "@nestjs/graphql";

import GraphQLJSON from "graphql-type-json";
import { SimpleRoleResponse } from "./simple-roles.response";
import { ValidRoles } from "../../enums/valid-roles";
import { SimplePermissionResponse } from "../../../permissions/dto/responses/simple-permission.response";

@ObjectType()
export class RestoreRoleResponse {

  @Field(() => String, { description: 'id of the role' })
  id: string;

  @Field(() => ValidRoles, { description: 'name of the role' })
  name: ValidRoles;

  @Field(() => String, { description: 'description of the role', nullable: true })
  description?: string;

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
    description: 'Stores dynamic rules and restoration metadata.',
    nullable: true,
  })
  metadata?: Record<string, any>;

  @Field(() => Date, {
    description: 'Creation timestamp',
    nullable: true
  })
  createdAt?: Date;

  @Field(() => Date, {
    description: 'Restoration timestamp',
    nullable: true
  })
  restoredAt?: Date;

  // 🔗 Relaciones simplificadas
  @Field(() => SimpleRoleResponse, { description: 'parent role for hierarchy', nullable: true })
  parent?: SimpleRoleResponse;

  @Field(() => [SimplePermissionResponse], { description: 'permissions assigned to this role', nullable: true })
  permissions?: SimplePermissionResponse[];

  // 🆕 Campos específicos de restauración

  @Field(() => Int, {
    description: 'Number of ancestor roles affected by this restoration',
    nullable: true
  })
  affectedAncestorsCount: number;

  @Field(() => String, {
    description: 'Success message about the restoration',
    nullable: true
  })
  message?: string;
}
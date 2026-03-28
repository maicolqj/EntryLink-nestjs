import { ObjectType, Field, Int } from "@nestjs/graphql";
import { Permission } from "../../../permissions/entities/permission.entity";
import { SimpleRoleResponse } from "./simple-roles.response";
import { ValidRoles } from "../../enums/valid-roles";

@ObjectType()
export class PermissionGroupSummary {
  @Field(() => String, { description: 'Nombre del grupo de permisos (ej: USERS, PACKAGES)' })
  group: string;

  @Field(() => Int, { description: 'Cantidad de permisos en este grupo' })
  count: number;

  @Field(() => [Permission], { description: 'Permisos de este grupo' })
  permissions: Permission[];
}

@ObjectType()
export class RoleDetailResponse {
  @Field(() => String)
  id: string;

  @Field(() => ValidRoles)
  name: ValidRoles;

  @Field(() => String)
  frontName: string;

  @Field(() => String)
  icon: string;

  @Field(() => String, { nullable: true })
  description?: string;

  @Field(() => Int)
  hierarchyLevel: number;

  @Field(() => Boolean)
  status: boolean;

  @Field(() => Boolean)
  isSystem: boolean;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => SimpleRoleResponse, { nullable: true, description: 'Rol padre en la jerarquía' })
  parent?: SimpleRoleResponse;

  @Field(() => [SimpleRoleResponse], { nullable: true, description: 'Roles hijos en la jerarquía' })
  children?: SimpleRoleResponse[];

  @Field(() => [Permission], { description: 'Todos los permisos asignados al rol' })
  permissions: Permission[];

  @Field(() => Int, { description: 'Total de permisos asignados' })
  permissionCount: number;

  @Field(() => [PermissionGroupSummary], { description: 'Permisos organizados por grupo' })
  permissionsByGroup: PermissionGroupSummary[];
}

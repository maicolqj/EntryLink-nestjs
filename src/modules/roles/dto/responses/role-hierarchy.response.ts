import { ObjectType, Field } from "@nestjs/graphql";
import { HierarchyRoleInfo } from "./hierarchy-role-info.response";
import { HierarchyStats } from "./hierarchy-stats.response";
import { SimpleRoleResponse } from "./simple-roles.response";
import { PermissionWithSource } from "./permission-with-source.response";

@ObjectType()
export class RoleHierarchyResponse {

  @Field(() => SimpleRoleResponse, { description: 'Role information' })
  role: SimpleRoleResponse;

  @Field(() => [HierarchyRoleInfo], { description: 'Ancestor roles' })
  ancestors: HierarchyRoleInfo[];

  @Field(() => [HierarchyRoleInfo], { description: 'Descendant roles' })
  descendants: HierarchyRoleInfo[];

  @Field(() => [PermissionWithSource], { description: 'Direct permissions' })
  directPermissions: PermissionWithSource[];

  @Field(() => [PermissionWithSource], { description: 'All effective permissions' })
  effectivePermissions: PermissionWithSource[];

  @Field(() => HierarchyStats, { description: 'Hierarchy statistics' })
  stats: HierarchyStats;
}
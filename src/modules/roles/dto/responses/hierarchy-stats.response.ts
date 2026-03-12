import { ObjectType, Field, Int } from "@nestjs/graphql";


@ObjectType()
export class HierarchyStats {
  @Field(() => Int, { description: 'Number of ancestors' })
  ancestorCount: number;

  @Field(() => Int, { description: 'Number of descendants' })
  descendantCount: number;

  @Field(() => Int, { description: 'Number of direct permissions' })
  directPermissionCount: number;

  @Field(() => Int, { description: 'Number of effective permissions' })
  effectivePermissionCount: number;
}
import { ObjectType, Field, Int } from "@nestjs/graphql";
import { ValidRoles } from "../../enums/valid-roles";


@ObjectType()
export class HierarchyRoleInfo {
  @Field(() => String, { description: 'Role ID' })
  id: string;

  @Field(() => ValidRoles, { description: 'Role name' })
  name: ValidRoles;

  @Field(() => Int, { description: 'Hierarchy level' })
  hierarchyLevel: number;

  @Field(() => Int, { description: 'Distance from the reference role' })
  distance: number;
}
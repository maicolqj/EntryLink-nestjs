import { ObjectType, Field, Int } from "@nestjs/graphql";

import { AssignedChildResult } from "./assigned-child.result";

@ObjectType()
export class AssignChildrenResponse {

  @Field(() => String, { description: 'ID of the parent role' })
  parentId: string;

  @Field(() => String, { description: 'Name of the parent role' })
  parentName: string;

  @Field(() => [AssignedChildResult], { description: 'Results of child assignments' })
  assignedChildren: AssignedChildResult[];

  @Field(() => Int, { description: 'Number of ancestor roles affected' })
  affectedAncestorsCount: number;

  @Field(() => String, { description: 'Success message' })
  message: string;
}
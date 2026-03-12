import { ObjectType, Field, Int } from "@nestjs/graphql";
import { SimpleRoleResponse } from "./simple-roles.response";

@ObjectType()
export class MoveSubtreeResponse {

  @Field(() => String, { description: 'ID of the root role that was moved' })
  movedRoleId: string;

  @Field(() => String, { description: 'Name of the root role that was moved' })
  movedRoleName: string;

  @Field(() => Int, { description: 'Number of descendant roles that were also moved' })
  descendantsCount: number;

  @Field(() => SimpleRoleResponse, { description: 'New parent role information', nullable: true })
  newParent?: SimpleRoleResponse;

  @Field(() => Int, { description: 'Total number of roles affected by this move' })
  affectedRolesCount: number;

  @Field(() => String, { description: 'Success message' })
  message: string;
}
import { ObjectType, Field, Int } from "@nestjs/graphql";
import { SimpleRoleResponse } from "./simple-roles.response";
import { ValidRoles } from "../../enums/valid-roles";

@ObjectType()
export class ChangeParentResponse {

  @Field(() => String, { description: 'ID of the role that was moved' })
  roleId: string;

  @Field(() => ValidRoles, { description: 'Name of the role that was moved' })
  roleName: ValidRoles;

  @Field(() => SimpleRoleResponse, { description: 'Previous parent role information', nullable: true })
  oldParent?: SimpleRoleResponse;

  @Field(() => SimpleRoleResponse, { description: 'New parent role information', nullable: true })
  newParent?: SimpleRoleResponse;

  @Field(() => Int, { description: 'Number of roles affected by this change' })
  affectedRolesCount: number;
  
  @Field(() => String, { description: 'Success message' })
  message: string;
}
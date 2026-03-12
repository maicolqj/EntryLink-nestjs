import { ObjectType, Field } from "@nestjs/graphql";
import GraphQLJSON from "graphql-type-json";
import { PermissionDependencyRemoveResponse } from "./remove-dependecy-permission.response";
import { ValidPermissions } from "../../enums/valid-permissions";
import { PermissionLevel } from "../../enums/level-permissions";

@ObjectType()
export class RestorePermissionResponse {
  @Field(() => String, { description: 'Unique identifier of the permission' })
  id: string;

  @Field(() => ValidPermissions, { description: 'Name of the permission' })
  name: ValidPermissions;

  @Field(() => String, { description: 'Description of the permission' })
  description: string;

  @Field(() => Boolean, { description: 'Status of the permission (true when restored)' })
  status: boolean;

  @Field(() => PermissionLevel, { description: 'Level of the permission' })
  level: PermissionLevel;

  @Field(() => Boolean, { description: 'Indicates if it is a system permission' })
  isSystem: boolean;

  @Field(() => String, { nullable: true, description: 'Additional metadata' })
  label?: string;

  @Field(() => String, { description: 'group of the permission' })
  group: string;

  @Field(() => [PermissionDependencyRemoveResponse], { description: 'Permission dependencies' })
  dependsOn: PermissionDependencyRemoveResponse[];

  @Field(() => Date, { description: 'Date when the permission was restored' })
  restoredAt: Date;

  @Field(() => Date, { description: 'Date when the permission was created' })
  createdAt: Date;

  @Field(() => String, { description: 'Success message' })
  message: string;
}
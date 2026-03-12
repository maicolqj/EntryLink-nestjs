import { ObjectType, Field } from "@nestjs/graphql";
import { ValidPermissions } from "../../../permissions/enums/valid-permissions";

@ObjectType()
export class PermissionWithSource {

  @Field(() => String, { description: 'Permission ID' })
  id: string;

  @Field(() => ValidPermissions, { description: 'Permission name' })
  name: ValidPermissions;

  @Field(() => String, { description: 'Source of the permission (DIRECT or INHERITED)' })
  source: string;
}
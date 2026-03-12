import { ObjectType, Field } from "@nestjs/graphql";
import { ValidPermissions } from "../../enums/valid-permissions";

@ObjectType()
export class PermissionDependencyRemoveResponse {
  @Field(() => String)
  id: string;

  @Field(() => ValidPermissions)
  name: ValidPermissions;
}
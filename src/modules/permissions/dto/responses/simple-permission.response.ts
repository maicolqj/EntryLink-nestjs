import { ObjectType, Field, Int } from "@nestjs/graphql";
import { ValidPermissions } from "../../enums/valid-permissions";

@ObjectType()
export class SimplePermissionResponse {

  @Field(() => String, { description: 'id of the permission' })
  id: string;

  @Field(() => ValidPermissions, { description: 'name of the permission' })
  name?: ValidPermissions;

  @Field(() => String, { description: 'description of the permission', nullable: true })
  description?: string;

  @Field(() => String, { description: 'category of the permission', nullable: true })
  category?: string;

  @Field(() => String, { description: 'level of the permission', nullable: true })
  level?: string;
}
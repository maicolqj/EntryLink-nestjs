import { Field, Int, ObjectType } from "@nestjs/graphql";
import GraphQLJSON from "graphql-type-json";

import { PermissionDependencyResponse } from "./permission-dependecy.response";
import { ValidPermissions } from "../../enums/valid-permissions";
import { PermissionLevel } from "../../enums/level-permissions";

@ObjectType()
export class CreatePermissionResponse {

  @Field(() => String, { description: 'id of the permission' })
  id: string;

  @Field(() => ValidPermissions, { description: 'name of the permission', nullable: false, })
  name: ValidPermissions;

  @Field(() => String, { description: 'description of the permission', nullable: true })
  description?: string;

  @Field(() => [PermissionDependencyResponse], { description: 'indicates the permissions on which the saved permission depends', nullable: true })
  dependsOn?: PermissionDependencyResponse[];

  @Field(() => Boolean, { description: 'indicates if permission is active', nullable: true })
  status?: boolean;

  @Field(() => PermissionLevel, { description: 'level of the permission', nullable: true })
  level: PermissionLevel;


  @Field(() => Boolean, { description: 'Select critical permissions that cannot be removed', nullable: true })
  isSystem: boolean;

  @Field(() => GraphQLJSON, { description: 'Stores dynamic rules (e.g., access schedules, usage limits).', nullable: true })
  metadata?: Record<string, any>;

  @Field(() => String, { description: 'category to which a permit belongs', nullable: true })
  category?: string;

  @Field(() => Date, { description: 'Creation timestamp', nullable: true })
  createdAt: Date;

}
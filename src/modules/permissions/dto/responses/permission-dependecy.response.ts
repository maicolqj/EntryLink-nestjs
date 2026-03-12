// permission-dependency.response.ts
import { ObjectType, Field } from '@nestjs/graphql';
import { ValidPermissions } from '../../enums/valid-permissions';

@ObjectType()
export class PermissionDependencyResponse {
  @Field(() => String)
  id: string;

  @Field(() => ValidPermissions)
  name: ValidPermissions;

  @Field(() => String, {nullable: true})
  description?: string;
}
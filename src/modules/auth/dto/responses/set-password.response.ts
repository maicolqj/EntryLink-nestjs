import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType()
export class SetPasswordResponse {
  @Field(() => Boolean)
  success: boolean;
}

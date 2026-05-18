import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType()
export class RequestPasswordResetResponse {
  @Field(() => Boolean)
  success: boolean;

  @Field(() => String)
  message: string;
}

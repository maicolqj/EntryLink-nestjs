import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType()
export class PushSubscriptionResult {
  @Field()
  success: boolean;
}

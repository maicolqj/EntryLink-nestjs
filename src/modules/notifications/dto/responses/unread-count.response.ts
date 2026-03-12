import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType()
export class UnreadCountResponse {
  @Field(() => Int)
  count: number;
}

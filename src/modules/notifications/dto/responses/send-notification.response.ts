import { ObjectType, Field, ID } from '@nestjs/graphql';

@ObjectType()
export class SendNotificationResult {
  @Field(() => ID)
  id: string;

  @Field()
  title: string;

  @Field()
  body: string;

  @Field()
  createdAt: Date;
}

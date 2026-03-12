import { ObjectType, Field, Int } from '@nestjs/graphql';
import { UserBasicResponse } from './user-basic.response';

@ObjectType()
export class AuthTokensResponse {
  @Field()
  accessToken: string;

  @Field()
  refreshToken: string;

  @Field(() => Int)
  expiresIn: number;

  @Field()
  sessionId: string;

  @Field({ nullable: true })
  message?: string;
  
  @Field(() => UserBasicResponse)
  user: UserBasicResponse;
}
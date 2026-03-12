
import { ObjectType, Field, Int } from '@nestjs/graphql';
import { UserBasicResponse } from './user-basic.response';

@ObjectType()
export class UserAuthResponse {
  @Field(() => Boolean)
  success: boolean;

  @Field(() => String)
  message: string;

  @Field(() => UserBasicResponse)
  user: UserBasicResponse;

  @Field(() => String)
  accessToken: string;

  @Field(() => String)
  refreshToken: string;

  @Field(() => Int)
  expiresIn: number;

  @Field(() => String)
  sessionId: string;
}
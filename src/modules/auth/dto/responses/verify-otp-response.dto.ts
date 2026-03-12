
import { ObjectType, Field, Int } from '@nestjs/graphql';
import { UserBasicResponse } from './user-basic.response';


@ObjectType()
export class BasicResponse {
  @Field()
  success: boolean;

  @Field()
  message: string;
}

@ObjectType()
export class VerifyOtpResponse {
  @Field(() => Boolean)
  success: boolean;

  @Field(() => String)
  message: string;

  @Field(() => Boolean)
  userExists: boolean;

  @Field(() => UserBasicResponse, { nullable: true })
  user?: UserBasicResponse;

  @Field(() => String, { nullable: true })
  accessToken?: string;

  @Field(() => String, { nullable: true })
  refreshToken?: string;

  @Field(() => Int, { nullable: true })
  expiresIn?: number;

  @Field(() => String, { nullable: true })
  sessionId?: string;

  @Field(() => String, { nullable: true })
  verifiedPhone?: string;
}
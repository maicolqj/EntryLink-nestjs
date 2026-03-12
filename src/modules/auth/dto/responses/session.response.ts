import { ObjectType, Field } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';

@ObjectType()
export class SessionResponse {
  @Field(() => String)
  id: string;

  @Field(() => String)
  deviceFingerprint: string;

  @Field(() => GraphQLJSON)
  deviceInfo: {
    userAgent: string;
    ip: string;
    platform: string;
    deviceId?: string;
    appVersion?: string;
  };

  @Field(() => String)
  status: string;

  @Field(() => Date, { nullable: true })
  lastActivityAt?: Date;

  @Field(() => String, { nullable: true })
  lastIp?: string;

  @Field(() => Date)
  createdAt: Date;
}
import { Field, ObjectType } from '@nestjs/graphql';

/** Un servidor STUN/TURN tal como lo pide RTCPeerConnection. */
@ObjectType()
export class IceServer {
  @Field(() => [String])
  urls: string[];

  @Field(() => String, { nullable: true })
  username?: string;

  @Field(() => String, { nullable: true })
  credential?: string;
}

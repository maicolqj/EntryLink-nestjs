import { InputType, Field } from '@nestjs/graphql';
import { IsString, IsNotEmpty, IsUrl } from 'class-validator';

/** Input para registrar una suscripción Web Push (dashboard web) */
@InputType()
export class SavePushSubscriptionInput {

  @Field()
  @IsString()
  @IsNotEmpty()
  complexId: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  endpoint: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  p256dh: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  auth: string;
}

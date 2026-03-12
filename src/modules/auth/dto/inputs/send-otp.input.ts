import { InputType, Field } from "@nestjs/graphql";
import { IsPhoneNumber, IsNotEmpty, IsString, IsOptional } from "class-validator";

@InputType()
export class SendOtpInput {
  @Field()
  @IsPhoneNumber('CO')
  @IsNotEmpty()
  phoneNumber: string;

}
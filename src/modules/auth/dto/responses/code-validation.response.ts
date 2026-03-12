import { Field, ObjectType } from "@nestjs/graphql";

@ObjectType()
export class PhoneVerificationResponse {
    @Field(() => Boolean, { description: 'Verification operation status', nullable: true })
    success?: boolean;

    @Field(() =>Boolean, {description: 'operation response message', nullable: true})
    message?: string;

    @Field(() =>Boolean, {description: 'temp token generate', nullable: true})
    tempToken?: string;

    @Field(() =>Boolean, {description: 'expiration time token', nullable: true})
    expiresIn?: string;
}
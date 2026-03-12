import { Field, ObjectType } from "@nestjs/graphql";

@ObjectType()
export class EmailVerificationResponse {
    @Field(() =>Boolean, {description: 'Verification operation status', nullable: true})
    success?: boolean;

    @Field(() =>String, {description: 'operation response message', nullable: true})
    message?: string;

}
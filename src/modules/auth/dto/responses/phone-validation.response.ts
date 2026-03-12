import { Field, ObjectType } from "@nestjs/graphql";

@ObjectType()
export class PhoneValidationResponse {

    @Field(() =>Boolean, {description: 'Verification operation status', nullable: true})
    success?: boolean;

    @Field(() =>String, {description: 'operation response message', nullable: true})
    message?: string;


    @Field(() =>Boolean, {description: 'phone number being validated', nullable: true})
    phoneNumber?: boolean;
   
    @Field(() =>Boolean, {description: 'phone number being validated', nullable: true})
    canProceedToRegistration?: boolean;

    @Field(() =>Number, {description: 'remaining Validation Time in Minutes', nullable: true})
    remainingValidationTimeMinutes?: number;

    @Field(() =>Boolean, {description: 'user exist', nullable: true})
    userExists?: boolean;
}
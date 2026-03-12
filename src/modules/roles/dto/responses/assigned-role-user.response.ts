import { Field, ObjectType } from "@nestjs/graphql";

@ObjectType()
export class AssignedUserRolResponse {
    @Field()
    success: boolean;

    @Field()
    message: string;


}
import { Field, Float, ObjectType } from "@nestjs/graphql";

@ObjectType()
export class    UserBasicResponse {
    @Field(() => String, { description: 'Unique user identifier', nullable: true })
    id: string;

    @Field(() => String, { description: 'name of the user', nullable: true })
    name?: string;
    
    @Field(() => String, { description: 'lastName of the user', nullable: true })
    lastName?: string;

    @Field(() => String, { description: 'Public user identifier', nullable: true })
    publicId?: string;

    @Field(() => String, { description: 'Profile picture URL', nullable: true })
    profilePicture?: string;

    @Field(() => String, { description: 'Cover picture URL', nullable: true })
    coverPicture?: string;


}
import { ObjectType, Field } from "@nestjs/graphql";
import { Permission } from "../../entities/permission.entity";
import { PaginationReponse } from "../../../shared/dto/responses/pagination-object.response";


@ObjectType()
export class PaginatedPermissionsResponse {

    @Field(() => [Permission])
    items: Permission[];

    @Field(() => PaginationReponse)
    meta: PaginationReponse;
}
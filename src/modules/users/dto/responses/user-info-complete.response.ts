// src/users/dto/responses/user-info-complete.response.ts
import { Field, Float, ObjectType } from "@nestjs/graphql";
import { Country, } from "../../entities/user.entity";
import GraphQLJSON from "graphql-type-json";
import { Gender, UserStatus } from "../../enums/user.enums";
import { UserRole } from "../../entities/user_has_roles.entity";


@ObjectType({
    description: 'CountryCode'
})
export class CountryNew {
    @Field()
    code: string;

    @Field()
    name: string;

    @Field()
    dialCode: string;

    @Field()
    flag: string;
}

@ObjectType({ description: 'Información completa del perfil del usuario autenticado' })
export class UserInfoCompleteResponse {

    // ================== IDENTIFICACIÓN ==================

    @Field(() => String, { description: 'Identificador único del usuario' })
    id: string;

    @Field(() => String, { description: 'Identificador público del usuario' })
    publicId?: string;

    // ================== DATOS PERSONALES ==================

    @Field(() => String, { description: 'Nombre del usuario' })
    name: string;

    @Field(() => String, { description: 'Apellido del usuario' })
    lastName: string;

    @Field(() => String, { description: 'Número de documento de identidad', nullable: true })
    identity?: string;

    @Field(() => Date, { description: 'Fecha de nacimiento', nullable: true })
    dateOfBirth?: Date;

    @Field(() => Gender, { description: 'Género del usuario', nullable: true })
    gender?: Gender;

    @Field(() => String, { description: 'Biografía del usuario', nullable: true })
    bio?: string;

    // ================== DATOS DE CONTACTO ==================

    @Field(() => String, { description: 'Número de teléfono' })
    phoneNumber: string;

    @Field(() => Country)
    countryCode: Country;

    @Field(() => String, { description: 'Correo electrónico' })
    email: string; 

    // ================== IMÁGENES ==================

    @Field(() => String, { description: 'URL de la foto de perfil', nullable: true })
    profilePicture?: string;

    @Field(() => String, { description: 'URL de la foto de portada', nullable: true })
    coverPicture?: string;

    // ================== VERIFICACIONES ==================

    @Field(() => Boolean, { description: 'Estado de verificación del teléfono' })
    phoneVerified: boolean;

    @Field(() => Boolean, { description: 'Estado de verificación del email' })
    emailVerified: boolean;

    @Field(() => Boolean, { description: 'Estado de verificación de identidad' })
    identityVerified: boolean;

    // ================== ESTADO Y RATING ==================


    @Field(() => UserStatus, { description: 'Estado actual de la cuenta' })
    status: UserStatus;

    @Field(() => Float, { description: 'Calificación del usuario (1-5)', defaultValue: 5.0 })
    rating: number;

    // ================== PREFERENCIAS ==================

    @Field(() => Boolean, { description: 'Acepta recibir marketing' })
    acceptsMarketing: boolean;

    @Field(() => String, { description: 'Idioma preferido', nullable: true })
    preferredLanguage?: string;

    @Field(() => String, { description: 'Zona horaria preferida', nullable: true })
    timezone?: string;
  
  
    @Field(() => String, { description: 'Zona horaria preferida', nullable: true })
    systemCode?: string;
    @Field(() => String, { description: 'Zona horaria preferida', nullable: true })
    complexId?: string;
    @Field(() => [UserRole], { description: 'Zona horaria preferida', nullable: true })
    userRoles?: UserRole[];

    // ================== NOTIFICACIONES ==================

    @Field(() => String, { description: 'Token para notificaciones push', nullable: true })
    notificationToken?: string;

    // ================== TIMESTAMPS ==================

    @Field(() => Date, { description: 'Fecha de creación de la cuenta' })
    createdAt: Date;

    @Field(() => Date, { description: 'Fecha de última actualización' })
    updatedAt: Date;

    // ================== CAMPOS CALCULADOS ==================

    @Field(() => String, { description: 'Nombre completo del usuario (nombre + apellido)' })
    get fullName(): string {
        return `${this.name} ${this.lastName}`.trim();
    }

    @Field(() => Boolean, { description: 'Indica si el usuario tiene tanto email como teléfono verificados' })
    get isFullyVerified(): boolean {
        return this.emailVerified && this.phoneVerified;
    }

    @Field(() => Number, { description: 'Edad calculada del usuario basada en su fecha de nacimiento', nullable: true })
    get age(): number | null {
        if (!this.dateOfBirth) return null;

        const today = new Date();
        const birthDate = new Date(this.dateOfBirth);
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();

        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }

        return age;
    }
}
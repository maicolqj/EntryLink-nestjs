import { Country, User } from "../../../../modules/users/entities/user.entity"
import { UserRole } from "../../../../modules/users/entities/user_has_roles.entity"
import { Gender } from "../../../../modules/users/enums/user.enums"

export interface UserSeedData {
    id: string
    name: string
    lastName: string
    phoneNumber: string
    countryCode: Country
    identity: string
    email: string
    password: string
    systemCode: string
    phoneVerified: boolean
    emailVerified: boolean
    identityVerified: boolean
    dateOfBirth: Date
    gender: Gender
    bio: string,
    rating: number,
    preferredLanguage: string
    acceptsMarketing: boolean
    acceptTermsAdnConditions: boolean,
    userRoles: UserRole[]
}

export const USER_TO_SEED: UserSeedData[] = [
    {
        id: 'f3b9d0a1-b2c3-4d4e-af6a-7b8c9d0e1f2b',
        name: 'Maicol',
        lastName: 'Quiñones',
        phoneNumber: '3168325485',
        countryCode: {
            code: 'CO',
            name: 'Colombia',
            dialCode: '+57',
            flag: '🇨🇴'
        },
        identity: '1012427216',
        email: 'maicolqj.crow@gmail.com',
        password: '123456Ab*',
        phoneVerified: true,
        emailVerified: true,
        identityVerified: true,
        dateOfBirth: new Date('1995-11-07T15:30:00.000Z'),
        gender: Gender.MALE,
        bio: 'Administradir del sistema',
        rating: 5,
        preferredLanguage: 'es-CO',
        systemCode: 'REs-2026-2620',
        acceptsMarketing: true,
        acceptTermsAdnConditions: true,
        userRoles: [

        ] 
    },
]
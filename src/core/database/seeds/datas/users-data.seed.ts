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
    passwordSet: boolean
    phoneVerified: boolean
    emailVerified: boolean
    identityVerified: boolean
    dateOfBirth: Date
    gender: Gender
    bio: string,
    rating: number,
    preferredLanguage: string
    systemCode?: string
    acceptsMarketing: boolean
    acceptTermsAdnConditions: boolean,
    userRoles: UserRole[]
}

export const USER_TO_SEED: UserSeedData[] = [
    {
        id: 'f3b9d0a1-b2c3-4d4e-af6a-7b8c9d0e1f2b',
        name: 'Admin',
        lastName: 'Sistema',
        phoneNumber: process.env.SEED_ADMIN_PHONE ?? '3000000000',
        countryCode: {
            code: 'CO',
            name: 'Colombia',
            dialCode: '+57',
            flag: '🇨🇴'
        },
        identity: process.env.SEED_ADMIN_IDENTITY ?? '0000000000',
        email: process.env.SEED_ADMIN_EMAIL ?? 'soporte@alternaqj.com',
        password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!',
        passwordSet: true,
        phoneVerified: true,
        emailVerified: true,
        identityVerified: true,
        dateOfBirth: new Date('1995-11-07T15:30:00.000Z'),
        gender: Gender.MALE,
        bio: 'Administradir del sistema',
        rating: 5,
        preferredLanguage: 'es-CO',
        systemCode: process.env.SEED_ADMIN_CODE ?? 'RES-A0A11',
        acceptsMarketing: true,
        acceptTermsAdnConditions: true,
        userRoles: [

        ] 
    },
]
import { registerEnumType } from "@nestjs/graphql";

export enum UserStatus {
    ACTIVE = 'active', //* indica que el usuario esta activo
    INACTIVE = 'inactive', //* indica que el usuario no ha tenido actividad en mucho tiempo
    SUSPENDED = 'suspended', //* se ha suspendido la cuenta temporalmente como sanción por parte de la aplicación por algun motivo
    PENDING_VERIFICATION = 'pending_verification', //* aun no ha realizado la verificacion completa de la cuenta
    DELETED = 'deleted', //* el usuario ha eliminado la cuenta
    BANNED = 'BANNED',                             // Baneado permanentemente
}
   
export enum Gender {
    MALE = 'male',
    FEMALE = 'female',
    PREFER_NOT_TO_SAY = 'prefer_not_to_say'
}

export enum UserIdentityType {
    CC         = 'CC',         // Cédula de Ciudadanía
    CE         = 'CE',         // Cédula de Extranjería
    PASSPORT   = 'PASSPORT',   // Pasaporte
    TI         = 'TI',         // Tarjeta de Identidad
    NIT        = 'NIT',        // NIT (persona jurídica)
    FOREIGN_ID = 'FOREIGN_ID', // Documento extranjero
    OTHER      = 'OTHER',      // Otro
}

// Registrar enums para GraphQL
registerEnumType(UserStatus, {
    name: 'UserStatus',
    description: 'Estados posibles de la cuenta de usuario'
});

registerEnumType(Gender, {
    name: 'Gender',
    description: 'Opciones de género disponibles'
});

registerEnumType(UserIdentityType, {
    name: 'UserIdentityType',
    description: 'Tipo de documento de identidad del usuario'
});

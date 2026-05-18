import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    OneToMany,
    BeforeInsert,
    BeforeUpdate,
    Index,
    Check,
} from 'typeorm';
import { ObjectType, Field, Float } from '@nestjs/graphql';
import { IsPhoneNumber, IsEnum } from 'class-validator';
import { Role } from '../../roles/entities/role.entity';
import { Gender, UserStatus } from '../enums/user.enums';
import { Permission } from '../../permissions/entities/permission.entity';
import { UserRole } from './user_has_roles.entity';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { hash, compare } from 'bcrypt'
import { VisitorParkingRate } from '../../visitor-parking/entities/visitor-parking-rate.entity';

@ObjectType({
    description: 'CountryCode'
})
export class Country {
    @Field()
    code: string;

    @Field()
    name: string;

    @Field()
    dialCode: string;

    @Field()
    flag: string;
}


@Entity({ name: 'users' })
@ObjectType({
    description: 'Entidad que representa un usuario del sistema'
})
@Index(['email'], { unique: true, where: '"deleted_at" IS NULL' })
@Index(['phoneNumber'], { unique: true, where: '"deleted_at" IS NULL' })
@Index(['identity'], { unique: true, where: '"identity" IS NOT NULL AND "deleted_at" IS NULL' })
@Index(['status', 'createdAt'])
@Index(['rating'])
@Index(['lastName', 'name'])
@Check('CHK_user_age_validation', `date_of_birth <= CURRENT_DATE - INTERVAL '14 years'`)
export class User {
    @PrimaryGeneratedColumn('uuid')
    @Field(() => String, { description: 'Unique user identifier' })
    id: string;

    @Column({ name: 'name', type: 'varchar', length: 100 })
    @Field(() => String, { description: 'Name of the user' })
    name: string;

    @Column({ name: 'last_name', type: 'varchar', length: 100 })
    @Field(() => String, { description: 'lastName of the user' })
    lastName: string;

    @Column({ name: 'number_phone', type: 'varchar', length: 13 })
    @IsPhoneNumber('CO')
    @Field(() => String, { description: 'Phone Number (only Colombia)' })
    phoneNumber: string;

    @Column({
        type: 'jsonb',
        nullable: true,
        name: 'country_code'
    })
    @Field(() => Country, { description: 'CountryCode' })
    countryCode: Country;

    @Column({ name: 'identity', type: 'varchar', length: 20, nullable: true, unique: true })
    @Field(() => String, { description: 'Identity document number', nullable: true })
    identity?: string;

    @Column({ name: 'email', type: 'varchar', length: 100, unique: true })
    @Field(() => String, { description: 'Email address' })
    email: string;

    @Column({ name: 'profilePicture', type: 'text', nullable: true })
    @Field(() => String, { description: 'Profile picture URL', nullable: true })
    profilePicture?: string;

    @Column({ name: 'coverPicture', type: 'text', nullable: true })
    @Field(() => String, { description: 'Profile picture of port URL', nullable: true })
    coverPicture?: string;
 
    @Column({ name: 'password', type: 'text', select: false })
    @Field(() => String, { description: 'Password', nullable: true })
    password: string;

    // ================== VERIFICACIONES ==================

    @Column({ name: 'phone_verified', type: 'boolean', default: false })
    @Field(() => Boolean, { description: 'Phone verification status' })
    phoneVerified: boolean;

    @Column({ name: 'email_verified', type: 'boolean', default: false })
    @Field(() => Boolean, { description: 'email verification status' })
    emailVerified: boolean;

    @Column({ name: 'identity_verified', type: 'boolean', default: false })
    @Field(() => Boolean, { description: 'identity verification status' })
    identityVerified: boolean;

    // ================== DATOS ADICIONALES ==================

    @Column({
        name: 'date_of_birth',
        type: 'date',
        nullable: true,
        transformer: {
            from: (value: Date | string) => value ? new Date(value) : null,
            to: (value: Date | string) => value ? new Date(value).toISOString().split('T')[0] : null
        }
    })
    @Field(() => Date, { description: 'Date of birth', nullable: true })
    dateOfBirth?: Date;

    @Column({ name: 'gender', type: 'enum', enum: Gender, nullable: true })
    @Field(() => Gender, { description: 'User gender', nullable: true })
    gender?: Gender;

    @Column({ name: 'bio', type: 'varchar', length: 500, nullable: true })
    @Field(() => String, { description: 'User biography', nullable: true })
    bio?: string;

    @Column({ name: 'rating', type: 'decimal', precision: 2, scale: 1, default: 5.0 })
    @Field(() => Float, { description: 'User rating (1-5)' })
    rating: number;


    @Column({ name: 'preferred_language', type: 'varchar', length: 5, default: 'es-CO' })
    @Field(() => String, { description: 'Users preferred language' })
    preferredLanguage: string;

    @Column({ name: 'timezone', type: 'varchar', length: 50, default: 'America/Bogota' })
    @Field(() => String, { description: 'Preferred time zone' })
    timezone: string;

      // ================== LOGIN POR QR ==================

    /** Token de un solo uso para login por código QR. Oculto por defecto en queries. */
    @Column({ name: 'qr_login_token', type: 'varchar', length: 36, nullable: true, unique: true, select: false })
    qrLoginToken?: string;

    @Column({ name: 'qr_login_token_exp', type: 'timestamptz', nullable: true, select: false })
    qrLoginTokenExp?: Date;

    @Column({ name: 'qr_login_token_used', type: 'boolean', default: false })
    qrLoginTokenUsed: boolean;

     // ================== RESET DE CONTRASEÑA ==================

    /**
     * Indica si el usuario ya estableció su contraseña al menos una vez.
     * false  → solo accedió por QR sin haber llamado a setInitialPassword.
     * true   → contraseña activa: puede usar requestPasswordReset por email.
     */
    @Column({ name: 'password_set', type: 'boolean', default: false })
    @Field(() => Boolean, { description: 'Indica si el usuario tiene contraseña establecida' })
    passwordSet: boolean;

    /** Token UUID de un solo uso para restablecimiento de contraseña por email. */
    @Column({ name: 'password_reset_token', type: 'varchar', length: 36, nullable: true, unique: true, select: false })
    passwordResetToken?: string;

    @Column({ name: 'password_reset_token_exp', type: 'timestamptz', nullable: true, select: false })
    passwordResetTokenExp?: Date;
    
    // ================== NOTIFICACIONES ==================

    @Column({ name: 'notification_token', type: 'text', nullable: true })
    @Field(() => String, { description: 'Token for push notifications', nullable: true })
    notificationToken?: string;

    @Column({ name: 'accepts_marketing', type: 'boolean', default: false })
    @Field(() => Boolean, { description: 'Indicates whether the user agrees to receive marketing emails.' })
    acceptsMarketing: boolean;

    @Column({ name: 'accepts_Terms_and_conditions', type: 'boolean', default: false })
    @Field(() => Boolean, { description: 'Indicates whether the user agrees accept terms and conditions.' })
    acceptTermsAdnConditions: boolean;

    // ================== SEGURIDAD ==================

    @Column({ name: 'failedLoginAttempts', type: 'smallint', default: 0 })
    @Field(() => Date, { description: 'Date until which the account is blocked due to failed attempts', nullable: true })
    failedLoginAttempts: number;

    @Column({ name: 'accountLockedUntil', type: 'timestamptz', nullable: true })
    @Field(() => Date, { description: 'Date until which the account is blocked due to failed attempts', nullable: true })
    accountLockedUntil?: Date;

    // ================== ESTADO Y AUDITORÍA ==================

    @Column({ name: 'status', type: 'enum', enum: UserStatus, default: UserStatus.PENDING_VERIFICATION })
    @IsEnum(UserStatus)
    @Field(() => UserStatus, { description: 'Current status of user account' })
    status: UserStatus;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    @Field(() => Date, { description: 'User creation date' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    @Field(() => Date, { description: 'Date of last user update' })
    updatedAt: Date;

    @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
    @Field(() => Date, { description: 'Deletion date (soft delete)', nullable: true })
    deletedAt?: Date;

    @Column({ name: 'deletion_reason', type: 'text', nullable: true })
    @Field(() => String, { description: 'Reason for account deletion', nullable: true })
    deletionReason?: string;

    @Column({ name: 'suspension_reason', type: 'text', nullable: true })
    @Field(() => String, { description: 'Reason for account suspension', nullable: true })
    suspensionReason?: string;

    // ================== AUTENTICACIÓN POR ROL ==================

    /**
     * Código de acceso para residentes.
     * Generado automáticamente al registrar el residente.
     * El residente usa su teléfono + este código para autenticarse.
     */
    @Column({ name: 'system_code', type: 'varchar', length: 20, nullable: true, unique: true })
    @Field(() => String, { description: 'Código de sistema asignado (solo residentes)', nullable: true })
    systemCode?: string;

    /**
     * Complejo residencial al que pertenece este usuario (para COMPLEX_ROL, SECURITY_ROL).
     * Permite que el administrador del complejo inicie sesión con el email del complejo.
     */
    @Column({ name: 'complex_id', type: 'uuid', nullable: true })
    @Field(() => String, { description: 'ID del complejo residencial asociado', nullable: true })
    complexId?: string;


    @Column({ name: 'company_card_url', type: 'varchar', length: 500, nullable: true })
    companyCardUrl?: string;

    @Column({ name: 'last_password_change', type: 'timestamptz', nullable: true })
    @Field(() => Date, { description: 'Date of last password change', nullable: true })
    lastPasswordChange?: Date;

    @Field(() => String, { description: 'token version', nullable: true })
    @Column({ type: 'int', default: 0 })
    tokenVersion: number;

    //**************************************************************************************************************************
    //**************************************************************************************************************************
    //*************************************************************RELACIONES***************************************************
    //**************************************************************************************************************************
    //**************************************************************************************************************************


    @OneToMany(() => Permission, (permission) => permission.createdByUser)
    @Field(() => [Permission], { nullable: true, description: 'Permissions created by this user' })
    createdPermissions?: Permission[];

    @OneToMany(() => Permission, (permission) => permission.updatedByUser)
    @Field(() => [Permission], { nullable: true, description: 'Permissions last updated by this user' })
    updatedPermissions?: Permission[];
 
    @OneToMany(() => VisitorParkingRate, (visitorParking) => visitorParking.createdByUser)
    @Field(() => [VisitorParkingRate], { nullable: true, description: 'Visitor last created by this user' })
    createVisitorParking?: VisitorParkingRate[];

    @OneToMany(() => VisitorParkingRate, (visitorParking) => visitorParking.updatedByUser)
    @Field(() => [VisitorParkingRate], { nullable: true, description: 'Visitor last updated by this user' })
    updateVisitorParking?: VisitorParkingRate[];

    @OneToMany(() => Role, (role) => role.createdByUser, { cascade: false })
    @Field(() => [Role], { nullable: true })
    createdRoles?: Role[];

    @OneToMany(() => Role, (role) => role.updatedByUser, { cascade: false })
    @Field(() => [Role], { nullable: true })
    updatedRoles?: Role[];

    @Field(() => [UserRole], { description: 'Detalles completos de la relación usuario-rol', nullable: true })
    @OneToMany(() => UserRole, userRole => userRole.user)
    userRoles: UserRole[];

    @Field(() => [ValidRoles], { description: 'Roles activos del usuario', nullable: true })
    get roles(): ValidRoles[] {
        return (this.userRoles ?? [])
            .filter(ur => ur.role)
            .map(ur => ur.role.name as ValidRoles)
            .filter(name => Object.values(ValidRoles).includes(name));
    }

    //**************************************************************************************************************************
    //**************************************************************************************************************************
    //*************************************************************HOOKS***************************************************
    //**************************************************************************************************************************
    //**************************************************************************************************************************


    @BeforeInsert()
    async beforeInsert() {
        await this.normalizeFields();
        await this.hashPassword();
    }

    @BeforeUpdate()
    async beforeUpdate() {
        await this.normalizeFields();
        this.updatedAt = new Date();
    }

    private async normalizeFields() {
        this.name = this.name?.toUpperCase().trim();
        this.lastName = this.lastName?.toUpperCase().trim();
        this.email = this.email?.toLowerCase().trim();
        this.phoneNumber = this.phoneNumber?.replace(/\s+/g, '');
    }

    private async hashPassword() {
        if (this.password) {
            this.password = await hash(this.password, Number(process.env.HASHSALT));
        }
    }

    // Método para comparar contraseñas (para login)
    async comparePassword(attempt: string): Promise<boolean> {
        return compare(attempt, this.password);
    }

    // Método estático para validar contraseñas antes de crear usuario
    static validatePasswordMatch(password: string, passwordConfirm: string): boolean {
        return password === passwordConfirm;
    }

    //**************************************************************************************************************************
    //**************************************************************************************************************************
    //******************************************************CAMPOS CALCULADOS***************************************************
    //**************************************************************************************************************************
    //**************************************************************************************************************************


    @Field(() => String, { description: 'Nombre completo del usuario (nombre + apellido)' })
    get fullName(): string {
        return `${this.name} ${this.lastName}`.trim();
    }

    @Field(() => Boolean, { description: 'Indica si el usuario tiene tanto email como teléfono verificados' })
    get isFullyVerified(): boolean {
        return this.emailVerified && this.phoneVerified && this.identityVerified;
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
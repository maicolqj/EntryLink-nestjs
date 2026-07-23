import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  BeforeInsert,
  BeforeUpdate,
  Index,
  OneToOne,
} from 'typeorm';
import { ObjectType, Field, Int, Float } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';

import { ComplexType } from '../enums/complex-type.enum';
import { ComplexPlan } from '../enums/complex-plan.enum';
import { ComplexStatus } from '../enums/complex-status.enum';
import { DpaValidationStatus } from '../enums/dpa-validation-status.enum';
import { Country, User } from '../../users/entities/user.entity';
import { Building } from './building.entity';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { VisitorParkingConfig } from '../../visitor-parking/entities/visitor-parking-config.entity';

@ObjectType({ description: 'Complejo residencial del sistema' })
@Entity({ name: 'residential_complexes' })
@Index(['status', 'plan'])
@Index(['slug'], { unique: true, where: '"deleted_at" IS NULL' })
// @Index(['ownerId'])
export class ResidentialComplex {

  @Field(() => String)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ==================== IDENTIFICACIÓN ====================

  @Field(() => String, { description: 'Nombre del complejo' })
  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Field(() => String, { description: 'Slug único derivado del nombre' })
  @Column({ type: 'varchar', length: 170, unique: true })
  slug: string;

  @Field(() => String, { description: 'Descripción del complejo', nullable: true })
  @Column({ type: 'text', nullable: true })
  description?: string;

  // ==================== UBICACIÓN ====================

  @Field(() => String, { description: 'Dirección principal del complejo', nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  address?: string;

  @Field(() => String, { description: 'Ciudad', nullable: true })
  @Column({ type: 'varchar', length: 100, nullable: true })
  city?: string;

  @Field(() => String, { description: 'Departamento o estado', nullable: true })
  @Column({ type: 'varchar', length: 100, nullable: true })
  state?: string;

  @Field(() => String, { description: 'País' })
  @Column({ type: 'varchar', length: 100, default: 'Colombia' })
  country: string;

  @Field(() => String, { description: 'Código postal', nullable: true })
  @Column({ type: 'varchar', length: 20, nullable: true })
  zipCode?: string;

  @Field(() => Float, { description: 'Latitud GPS del complejo para validación de presencia', nullable: true })
  @Column({ type: 'decimal', precision: 10, scale: 8, nullable: true })
  latitude?: number;

  @Field(() => Float, { description: 'Longitud GPS del complejo para validación de presencia', nullable: true })
  @Column({ type: 'decimal', precision: 11, scale: 8, nullable: true })
  longitude?: number;

  @Field(() => Int, { description: 'Radio en metros para validar presencia GPS (por defecto 200 m)', nullable: true })
  @Column({ name: 'gps_radius', type: 'int', nullable: true, default: 200 })
  gpsRadius?: number;

  // ==================== CLASIFICACIÓN ====================

  @Field(() => ComplexType, { description: 'Tipo de complejo residencial' })
  @Column({ type: 'enum', enum: ComplexType, default: ComplexType.APARTMENT_COMPLEX })
  type: ComplexType;

  @Field(() => ComplexPlan, { description: 'Plan de suscripción activo' })
  @Column({ type: 'enum', enum: ComplexPlan, default: ComplexPlan.FREE })
  plan: ComplexPlan;

  @Field(() => ComplexStatus, { description: 'Estado operativo del complejo' })
  @Column({ type: 'enum', enum: ComplexStatus, default: ComplexStatus.PENDING_SETUP })
  status: ComplexStatus;

  @Field(() => String, { description: 'token version', nullable: true })
  @Column({ type: 'int', default: 0 })
  tokenVersion: number;

  // ==================== CAPACIDAD ====================

  @Field(() => Int, { description: 'Máximo de unidades permitidas por el plan' })
  @Column({ type: 'int', default: 10 })
  maxUnits: number;

  // ==================== CONTACTO ====================

  @Column({
    type: 'jsonb',
    nullable: true,
    name: 'country_code'
  })
  @Field(() => Country, { description: 'CountryCode' })
  countryCode: Country;

  @Field(() => String, { description: 'Teléfono de administración', nullable: true })
  @Column({ type: 'varchar', length: 20, nullable: true })
  phoneNumber?: string;

  @Field(() => String, { description: 'Email administrativo', nullable: true })
  @Column({ type: 'varchar', length: 100, nullable: true })
  email?: string;

  @Column({ name: 'password', type: 'text', select: false, nullable: true })
  @Field(() => String, { description: 'Password', nullable: true })
  password?: string;

  @Field(() => String, { description: 'Sitio web', nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  website?: string;


  // ==================== IDENTIDAD LEGAL ====================

  @Field(() => String, { description: 'NIT o identificación fiscal', nullable: true })
  @Column({ type: 'varchar', length: 30, nullable: true })
  nit?: string;

  @Field(() => String, { description: 'ID del usuario representante legal', nullable: true })
  @Column({ name: 'legal_representative_id', type: 'uuid', nullable: true })
  legalRepresentativeId?: string;




  // ================== RESET DE CONTRASEÑA ==================

  /** Token UUID de un solo uso para restablecimiento de contraseña por email. */
  @Column({ name: 'password_reset_token', type: 'varchar', length: 36, nullable: true, unique: true, select: false })
  passwordResetToken?: string;

  @Column({ name: 'password_reset_token_exp', type: 'timestamptz', nullable: true, select: false })
  passwordResetTokenExp?: Date;

  // ================== SEGURIDAD ==================


  @Column({ name: 'failedLoginAttempts', type: 'smallint', default: 0 })
  @Field(() => Date, { description: 'Date until which the account is blocked due to failed attempts', nullable: true })
  failedLoginAttempts: number;

  @Column({ name: 'accountLockedUntil', type: 'timestamptz', nullable: true })
  @Field(() => Date, { description: 'Date until which the account is blocked due to failed attempts', nullable: true })
  accountLockedUntil?: Date;

  // ================== LOGIN POR QR ==================

  /** Token de un solo uso para login por código QR. Oculto por defecto en queries. */
  @Column({ name: 'qr_login_token', type: 'varchar', length: 36, nullable: true, unique: true, select: false })
  qrLoginToken?: string;

  @Column({ name: 'qr_login_token_exp', type: 'timestamptz', nullable: true, select: false })
  qrLoginTokenExp?: Date;

  @Column({ name: 'qr_login_token_used', type: 'boolean', default: false })
  qrLoginTokenUsed: boolean;

  /** PIN hasheado (bcrypt) de un solo uso para validar el canje del QR. Oculto por defecto. */
  @Column({ name: 'qr_login_pin', type: 'varchar', length: 72, nullable: true, select: false })
  qrLoginPin?: string;

  // ==================== REGISTRO / ONBOARDING ====================

  @Field(() => Int, { description: 'Total de unidades declaradas al registrar', nullable: true })
  @Column({ name: 'total_units', type: 'int', nullable: true })
  totalUnits?: number;

  @Field(() => Int, { description: 'Número de torres (APARTMENT_COMPLEX / MIXED_COMPLEX)', nullable: true })
  @Column({ name: 'number_of_towers', type: 'int', nullable: true })
  numberOfTowers?: number;

  @Field(() => String, { description: 'Nombre del representante legal', nullable: true })
  @Column({ name: 'legal_representative_name', type: 'varchar', length: 255, nullable: true })
  legalRepresentativeName?: string;

  @Field(() => String, { description: 'URL del RUT del complejo (R2)', nullable: true })
  @Column({ name: 'rut_file_url', type: 'text', nullable: true })
  rutFileUrl?: string;

  @Field(() => String, { description: 'URL del documento del representante legal (R2)', nullable: true })
  @Column({ name: 'legal_rep_document_url', type: 'text', nullable: true })
  legalRepDocumentUrl?: string;

  @Field(() => Date, { description: 'Fecha/hora en que se aceptaron Términos, Privacidad y DPA durante el registro', nullable: true })
  @Column({ name: 'accepted_terms_at', type: 'timestamptz', nullable: true })
  acceptedTermsAt?: Date;

  @Field(() => String, { description: 'URL del DPA (Anexo B2B) firmado, subido por el complejo (R2)', nullable: true })
  @Column({ name: 'signed_dpa_url', type: 'text', nullable: true })
  signedDpaUrl?: string;

  @Field(() => String, { description: 'Nombre del archivo del DPA firmado', nullable: true })
  @Column({ name: 'signed_dpa_file_name', type: 'varchar', length: 255, nullable: true })
  signedDpaFileName?: string;

  @Field(() => Date, { description: 'Fecha de subida del DPA firmado', nullable: true })
  @Column({ name: 'signed_dpa_uploaded_at', type: 'timestamptz', nullable: true })
  signedDpaUploadedAt?: Date;

  /** Key de R2 del DPA firmado, para reemplazo. Sin @Field = oculto en GraphQL. */
  @Column({ name: 'signed_dpa_public_id', type: 'text', nullable: true })
  signedDpaPublicId?: string;

  @Field(() => DpaValidationStatus, { description: 'Estado de validación del DPA firmado (revisión del SUPER_ADMIN)', nullable: true })
  @Column({ name: 'signed_dpa_status', type: 'enum', enum: DpaValidationStatus, nullable: true })
  signedDpaStatus?: DpaValidationStatus;

  @Field(() => String, { description: 'Motivo del rechazo del DPA firmado (si fue rechazado)', nullable: true })
  @Column({ name: 'signed_dpa_rejection_reason', type: 'text', nullable: true })
  signedDpaRejectionReason?: string;

  @Field(() => Date, { description: 'Fecha en que el SUPER_ADMIN revisó (aprobó/rechazó) el DPA firmado', nullable: true })
  @Column({ name: 'signed_dpa_reviewed_at', type: 'timestamptz', nullable: true })
  signedDpaReviewedAt?: Date;

  /** Usuario SUPER_ADMIN que revisó el DPA. Sin @Field = oculto en GraphQL. */
  @Column({ name: 'signed_dpa_reviewed_by_id', type: 'text', nullable: true })
  signedDpaReviewedById?: string;

  // ==================== IMÁGENES ====================

  @Field(() => String, { description: 'URL del logo del complejo', nullable: true })
  @Column({ type: 'text', nullable: true })
  logoUrl?: string;

  @Field(() => String, { description: 'URL de imagen de portada', nullable: true })
  @Column({ type: 'text', nullable: true })
  coverUrl?: string;


  @Column({ name: 'last_password_change', type: 'timestamptz', nullable: true })
  @Field(() => Date, { description: 'Date of last password change', nullable: true })
  lastPasswordChange?: Date;


  /* * Indica si el usuario ya estableció su contraseña al menos una vez.
       * false  → solo accedió por QR sin haber llamado a setInitialPassword.
       * true   → contraseña activa: puede usar requestPasswordReset por email.
       */
  @Column({ name: 'password_set', type: 'boolean', default: false })
  @Field(() => Boolean, { description: 'Indica si el usuario tiene contraseña establecida' })
  passwordSet: boolean;
  // ==================== CONFIGURACIÓN ====================

  @Field(() => GraphQLJSON, { description: 'Configuración avanzada del complejo', nullable: true })
  @Column({ type: 'jsonb', nullable: true, default: {} })
  settings?: Record<string, any>;

  @Field(() => [String], { description: 'Módulos habilitados para este complejo. Si es null o vacío, todos los módulos están habilitados.', nullable: true })
  @Column({ type: 'simple-array', nullable: true })
  enabledModules?: string[];

  // ==================== AUDITORÍA ====================

  @Field(() => String, { description: 'ID del propietario/administrador principal' })
  @Column({ type: 'uuid', name: 'owner_id', nullable: true })
  ownerId: string;

  @Field(() => Date)
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field(() => Date)
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date;

  // ==================== RELACIONES ====================

  @Field(() => User, { description: 'Propietario/administrador principal', nullable: true })
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'owner_id' })
  owner?: User;

  @Field(() => User, { description: 'Representante legal del complejo', nullable: true })
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL', eager: true })
  @JoinColumn({ name: 'legal_representative_id' })
  legalRepresentative?: User;

  @Field(() => [Building], { description: 'Torres o edificios del complejo', nullable: true })
  @OneToMany(() => Building, (building) => building.complex, { cascade: true })
  buildings?: Building[];

  @OneToOne(() => VisitorParkingConfig, (config) => config.complex)
  visitorParkingConfig: VisitorParkingConfig;

  // ==================== CAMPOS CALCULADOS ====================

  @Field(() => [ValidRoles], { description: 'Rol fijo del complejo residencial' })
  get roles(): ValidRoles[] {
    return [ValidRoles.COMPLEX_ROL];
  }

  // ==================== HOOKS ====================

  @BeforeInsert()
  @BeforeUpdate()
  normalizeFields() {
    this.name = this.name?.trim();
    this.address = this.address?.trim();
    this.city = this.city?.trim()?.toUpperCase();
    this.state = this.state?.trim()?.toUpperCase();
    this.country = this.country?.trim();
    this.slug = this.generateSlug(this.name);
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // quitar tildes
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .substring(0, 170);
  }
}
 
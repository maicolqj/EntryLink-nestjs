import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { WhatsAppLoginStatus } from '../enums/whatsapp-login-status.enum';

/**
 * Intento de login "reverse-OTP": en vez de que el sistema envíe un código al
 * residente (plantilla de Meta, que se cobra), es el residente quien envía un
 * nonce desde su propio WhatsApp. Los mensajes ENTRANTES no tienen costo, así
 * que el flujo completo es gratis.
 *
 * Reparto de secretos, que es lo que hace seguro el flujo:
 *   - `nonce` viaja por WhatsApp y por tanto se considera público: sirve para
 *     que el webhook sepa a qué intento corresponde el mensaje, nada más.
 *   - el `id` del challenge nunca sale del cliente que lo pidió y es lo único
 *     que permite canjear la sesión.
 * Por eso quien intercepte el nonce no puede iniciar sesión.
 *
 * Esta entidad NO se expone en GraphQL: el resolver devuelve DTOs recortados
 * para no filtrar `userId` ni el teléfono confirmado.
 */
@Entity({ name: 'whatsapp_login_challenges' })
@Index(['status', 'expiresAt'])
export class WhatsAppLoginChallenge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Código que el residente envía por WhatsApp. Público por diseño. */
  @Column({ name: 'nonce', type: 'varchar', length: 16, unique: true })
  nonce: string;

  /** Documento tal como lo escribió el solicitante (normalizado a minúscula). */
  @Column({ name: 'identity', type: 'varchar', length: 20 })
  identity: string;

  /**
   * Residente dueño de esa identidad. Nulo cuando la identidad no existe: el
   * challenge se emite igual para no revelar qué documentos están registrados,
   * y simplemente nunca llega a confirmarse.
   */
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId?: string;

  @Column({ name: 'status', type: 'varchar', length: 20, default: WhatsAppLoginStatus.PENDING })
  status: WhatsAppLoginStatus;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt?: Date;

  /** Teléfono desde el que llegó el mensaje, normalizado. Para auditoría. */
  @Column({ name: 'confirmed_from_phone', type: 'varchar', length: 20, nullable: true })
  confirmedFromPhone?: string;

  /**
   * Fingerprint del dispositivo que pidió el challenge. El canje lo exige
   * igual: así la sesión solo puede abrirse en el mismo navegador/app donde
   * empezó el flujo, aunque alguien más conozca el id.
   */
  @Column({ name: 'device_fingerprint', type: 'text' })
  deviceFingerprint: string;

  @Column({ name: 'requested_from_ip', type: 'varchar', length: 45, nullable: true })
  requestedFromIp?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

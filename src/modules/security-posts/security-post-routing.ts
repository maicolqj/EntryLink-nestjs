import { HttpStatus } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { CustomError } from '../shared/utils/errors.utils';
import { SecurityPostErrorCode } from '../shared/constans/error-codes.constants';
import { ValidRoles } from '../roles/enums/valid-roles';

/**
 * A qué portería va algo que el residente le manda a portería, y qué
 * vigilantes la atienden.
 *
 * Son funciones sobre el EntityManager, no un servicio inyectable, a
 * propósito: las usan notificaciones, citofonía y el registro de llamadas, y
 * NotificationsModule ya está en un ciclo con ResidentialComplexModule. Así
 * nadie tiene que importar el módulo de porterías.
 */

export interface SecurityPostRef {
  id: string;
  name: string;
}

export interface SecurityPostTarget {
  /** null = el conjunto no tiene porterías creadas: una sola, implícita. */
  post: SecurityPostRef | null;
  /** Vigilantes que deben enterarse. */
  guardUserIds: string[];
}

/**
 * Resuelve la portería destino.
 *
 * - Sin porterías creadas: todo el personal de portería del conjunto.
 * - Con porterías: la elegida. Si hay una sola, no hace falta elegir.
 * - Con varias y sin elegir: `strict` lo rechaza (lo nuevo exige elegir);
 *   sin `strict` le llega a todas, para no perder lo que manda una versión
 *   vieja de la app que todavía no sabe preguntar.
 */
export async function resolveSecurityPostTarget(
  manager: EntityManager,
  complexId: string,
  securityPostId: string | null | undefined,
  options: { strict: boolean },
): Promise<SecurityPostTarget> {
  const posts: Array<{ id: string; name: string }> = await manager.query(
    `SELECT id, name FROM security_posts
      WHERE complex_id = $1 AND is_active = true AND deleted_at IS NULL
      ORDER BY sort_order, name`,
    [complexId],
  );

  if (posts.length === 0) {
    return {
      post: null,
      guardUserIds: await findSecurityUserIds(manager, complexId, null),
    };
  }

  let post: SecurityPostRef | undefined;
  if (securityPostId) {
    post = posts.find((p) => p.id === securityPostId);
    if (!post) {
      throw new CustomError({
        message: 'Esa portería no existe o no está activa',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: SecurityPostErrorCode.SECURITY_POST_NOT_FOUND,
      });
    }
  } else if (posts.length === 1) {
    post = posts[0];
  } else if (options.strict) {
    throw new CustomError({
      message: 'El conjunto tiene varias porterías: elige a cuál',
      statusCode: HttpStatus.BAD_REQUEST,
      errorCode: SecurityPostErrorCode.SECURITY_POST_REQUIRED,
    });
  } else {
    return {
      post: null,
      guardUserIds: await findSecurityUserIds(manager, complexId, null),
    };
  }

  let guardUserIds = await findSecurityUserIds(manager, complexId, post.id);
  // Con una sola portería no hay a quién más dirigirlo: si ningún vigilante la
  // ha elegido todavía, igual le llega a todo el personal.
  if (guardUserIds.length === 0 && posts.length === 1) {
    guardUserIds = await findSecurityUserIds(manager, complexId, null);
  }

  return { post: { id: String(post.id), name: post.name }, guardUserIds };
}

/**
 * Personal de portería del conjunto; con `securityPostId`, solo el que está
 * en esa portería.
 */
export async function findSecurityUserIds(
  manager: EntityManager,
  complexId: string,
  securityPostId: string | null,
): Promise<string[]> {
  const rows: Array<{ id: string }> = await manager.query(
    `SELECT DISTINCT u.id
       FROM users u
       JOIN user_has_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       ${
         securityPostId
           ? `JOIN security_post_guards spg
                ON spg.user_id = u.id AND spg.security_post_id = $3`
           : ''
       }
      WHERE u.complex_id = $1
        AND u.deleted_at IS NULL
        AND r.name::text = $2
        AND r.status = true`,
    securityPostId
      ? [complexId, ValidRoles.SECURITY_ROL, securityPostId]
      : [complexId, ValidRoles.SECURITY_ROL],
  );
  return rows.map((row) => String(row.id));
}

/** La portería en la que está el vigilante ahora (null si no ha elegido). */
export async function findGuardSecurityPost(
  manager: EntityManager,
  userId: string,
): Promise<SecurityPostRef | null> {
  const rows: Array<{ id: string; name: string }> = await manager.query(
    `SELECT sp.id, sp.name
       FROM security_post_guards spg
       JOIN security_posts sp ON sp.id = spg.security_post_id
      WHERE spg.user_id = $1
        AND sp.is_active = true
        AND sp.deleted_at IS NULL`,
    [userId],
  );
  return rows[0] ? { id: String(rows[0].id), name: rows[0].name } : null;
}

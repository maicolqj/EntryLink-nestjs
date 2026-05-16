import { Request, Response, NextFunction } from 'express';

/**
 * Basic Auth middleware para el panel /admin/bull-board.
 * Credenciales definidas en BULL_BOARD_USER / BULL_BOARD_PASS.
 * Si las vars no están definidas en producción, bloquea el acceso completamente.
 */
export function bullBoardAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const isProd = process.env.NODE_ENV === 'production';
  const user   = process.env.BULL_BOARD_USER;
  const pass   = process.env.BULL_BOARD_PASS;

  if (isProd && (!user || !pass)) {
    res.status(503).json({ message: 'Bull Board disabled: credentials not configured.' });
    return;
  }

  if (!user || !pass) {
    return next();
  }

  const authorization = req.headers['authorization'];

  if (!authorization?.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
    res.status(401).json({ message: 'Authentication required.' });
    return;
  }

  const base64 = authorization.slice(6);
  const decoded = Buffer.from(base64, 'base64').toString('utf-8');
  const colonIndex = decoded.indexOf(':');

  if (colonIndex === -1) {
    res.status(401).json({ message: 'Invalid credentials format.' });
    return;
  }

  const providedUser = decoded.slice(0, colonIndex);
  const providedPass = decoded.slice(colonIndex + 1);

  // Comparación en tiempo constante para evitar timing attacks
  const userMatch = timingSafeEqual(providedUser, user);
  const passMatch = timingSafeEqual(providedPass, pass);

  if (!userMatch || !passMatch) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
    res.status(401).json({ message: 'Invalid credentials.' });
    return;
  }

  next();
}

function timingSafeEqual(a: string, b: string): boolean {
  const { timingSafeEqual: cryptoEqual } = require('crypto') as typeof import('crypto');
  const bufA = Buffer.alloc(Math.max(a.length, b.length), a);
  const bufB = Buffer.alloc(Math.max(a.length, b.length), b);
  return cryptoEqual(bufA, bufB);
}

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';

export interface AuthUser {
  sub: number;
  email: string;
  username: string;
  role: 'user' | 'admin';
}

export function signToken(payload: AuthUser): string {
  if (!config.jwtSecret) throw new Error('JWT_SECRET is not set');
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '30d' });
}

export function verifyToken(token: string): AuthUser | null {
  try {
    return jwt.verify(token, config.jwtSecret) as unknown as AuthUser;
  } catch {
    return null;
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function comparePassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

function extractToken(req: Request): string | null {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7).trim();
  if (typeof req.query.token === 'string') return req.query.token;
  return null;
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'No autenticado.' });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Sesión inválida o expirada.' });
    return;
  }
  req.user = payload;
  next();
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado.' });
    return;
  }
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Solo para administradores.' });
    return;
  }
  next();
}

export async function seedAdmin(): Promise<void> {
  if (!config.adminPassword) {
    console.warn('[auth] ADMIN_PASSWORD no configurado — se omite seed.');
    return;
  }
  const [existing] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, config.adminEmail))
    .limit(1);

  const passwordHash = await hashPassword(config.adminPassword);

  if (existing) {
    // Actualiza password + role por si cambió.
    await db
      .update(schema.users)
      .set({ passwordHash, role: 'admin', username: config.adminUsername })
      .where(eq(schema.users.id, existing.id));
    console.log(`[auth] admin "${config.adminUsername}" actualizado`);
    return;
  }

  await db.insert(schema.users).values({
    email: config.adminEmail,
    username: config.adminUsername,
    passwordHash,
    role: 'admin',
  });
  console.log(`[auth] admin "${config.adminUsername}" creado`);
}

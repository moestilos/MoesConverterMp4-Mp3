import { Router, type Request, type Response } from 'express';
import { db, schema } from '../db/index.js';
import { eq, or } from 'drizzle-orm';
import {
  comparePassword,
  hashPassword,
  requireAuth,
  signToken,
} from '../services/auth.js';

export const authRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

authRouter.post('/register', async (req: Request, res: Response) => {
  const { email, username, password } = (req.body ?? {}) as Record<
    string,
    unknown
  >;
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Email inválido.' });
  }
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return res
      .status(400)
      .json({ error: 'Username inválido (3-32 letras/números/._-).' });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Contraseña de al menos 6 caracteres.' });
  }

  const emailLower = email.toLowerCase().trim();
  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(or(eq(schema.users.email, emailLower), eq(schema.users.username, username)))
    .limit(1);

  if (existing.length > 0) {
    return res
      .status(409)
      .json({ error: 'Email o username ya registrados.' });
  }

  const passwordHash = await hashPassword(password);
  const [created] = await db
    .insert(schema.users)
    .values({ email: emailLower, username, passwordHash, role: 'user' })
    .returning();

  const token = signToken({
    sub: created.id,
    email: created.email,
    username: created.username,
    role: created.role as 'user' | 'admin',
  });

  res.status(201).json({
    token,
    user: {
      id: created.id,
      email: created.email,
      username: created.username,
      role: created.role,
    },
  });
});

authRouter.post('/login', async (req: Request, res: Response) => {
  const { identifier, password } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof identifier !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Credenciales requeridas.' });
  }

  const value = identifier.toLowerCase().trim();
  const [user] = await db
    .select()
    .from(schema.users)
    .where(or(eq(schema.users.email, value), eq(schema.users.username, identifier.trim())))
    .limit(1);

  if (!user) {
    return res.status(401).json({ error: 'Credenciales inválidas.' });
  }
  const ok = await comparePassword(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Credenciales inválidas.' });
  }

  const token = signToken({
    sub: user.id,
    email: user.email,
    username: user.username,
    role: user.role as 'user' | 'admin',
  });

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    },
  });
});

authRouter.get('/me', requireAuth, (req: Request, res: Response) => {
  res.json({ user: req.user });
});

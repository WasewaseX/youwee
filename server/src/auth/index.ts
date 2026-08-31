import { compare, hash } from 'bcryptjs';
import { and, eq, lt } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import { db } from '../db/index.js';
import { sessions, userSettings, users } from '../db/schema.js';

const SESSION_SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET || 'dev-secret-change-in-production',
);

const _SESSION_COOKIE_NAME = 'youwee_session';

export interface SessionPayload {
  userId: string;
  sessionId: string;
  email: string;
}

export async function createSessionCookie(payload: SessionPayload): Promise<string> {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(SESSION_SECRET);

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({
    id: payload.sessionId,
    userId: payload.userId,
    tokenHash: await hash(token, 12),
    expiresAt,
  });

  return token;
}

export async function verifySessionCookie(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SESSION_SECRET);
    const sessionId = payload.sessionId as string;
    const userId = payload.userId as string;

    const session = await db.query.sessions.findFirst({
      where: and(eq(sessions.id, sessionId), eq(sessions.userId, userId)),
    });

    if (!session || session.expiresAt < new Date()) {
      return null;
    }

    const isValid = await compare(token, session.tokenHash);
    if (!isValid) return null;

    return {
      userId,
      sessionId,
      email: payload.email as string,
    };
  } catch {
    return null;
  }
}

export async function deleteSession(token: string): Promise<void> {
  try {
    const { payload } = await jwtVerify(token, SESSION_SECRET);
    const sessionId = payload.sessionId as string;
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  } catch {
    // ignore
  }
}

export async function cleanupExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

export async function registerUser(
  email: string,
  password: string,
  name?: string,
): Promise<{ user: typeof users.$inferSelect; token: string }> {
  const existing = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
  });

  if (existing) {
    throw new Error('Email already registered');
  }

  const passwordHash = await hash(password, 12);
  const userId = crypto.randomUUID();

  const [user] = await db
    .insert(users)
    .values({
      id: userId,
      email: email.toLowerCase(),
      passwordHash,
      name,
    })
    .returning();

  await db.insert(userSettings).values({
    userId,
  });

  const sessionId = crypto.randomUUID();
  const token = await createSessionCookie({
    userId: user.id,
    sessionId,
    email: user.email,
  });

  return { user, token };
}

export async function loginUser(
  email: string,
  password: string,
): Promise<{ user: typeof users.$inferSelect; token: string }> {
  const user = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
  });

  if (!user) {
    throw new Error('Invalid credentials');
  }

  if (!user.isActive) {
    throw new Error('Account is disabled');
  }

  const isValid = await compare(password, user.passwordHash);
  if (!isValid) {
    throw new Error('Invalid credentials');
  }

  const sessionId = crypto.randomUUID();
  const token = await createSessionCookie({
    userId: user.id,
    sessionId,
    email: user.email,
  });

  return { user, token };
}

export async function logoutUser(token: string): Promise<void> {
  await deleteSession(token);
}

export async function getUserFromToken(token: string): Promise<typeof users.$inferSelect | null> {
  const session = await verifySessionCookie(token);
  if (!session) return null;

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });

  return user || null;
}

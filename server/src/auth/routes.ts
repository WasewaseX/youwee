import { Hono } from "hono";
import { z } from "zod";
import { registerUser, loginUser, logoutUser, getUserFromToken, verifySessionCookie } from "./index.js";

const auth = new Hono();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

auth.post("/register", async (c) => {
  try {
    const body = await c.req.json();
    const data = registerSchema.parse(body);

    const { user, token } = await registerUser(data.email, data.password, data.name);

    c.header("Set-Cookie", `youwee_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 60 * 60}`);

    return c.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
      },
    }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: error.errors }, 400);
    }
    return c.json({ error: error instanceof Error ? error.message : "Registration failed" }, 400);
  }
});

auth.post("/login", async (c) => {
  try {
    const body = await c.req.json();
    const data = loginSchema.parse(body);

    const { user, token } = await loginUser(data.email, data.password);

    c.header("Set-Cookie", `youwee_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 60 * 60}`);

    return c.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: "Validation failed", details: error.errors }, 400);
    }
    return c.json({ error: error instanceof Error ? error.message : "Login failed" }, 401);
  }
});

auth.post("/logout", async (c) => {
  const token = c.req.header("Cookie")?.split("youwee_session=")[1]?.split(";")[0];
  if (token) {
    await logoutUser(token);
  }

  c.header("Set-Cookie", "youwee_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");

  return c.json({ success: true });
});

auth.get("/me", async (c) => {
  const token = c.req.header("Cookie")?.split("youwee_session=")[1]?.split(";")[0];

  if (!token) {
    return c.json({ user: null }, 401);
  }

  const user = await getUserFromToken(token);

  if (!user) {
    c.header("Set-Cookie", "youwee_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
    return c.json({ user: null }, 401);
  }

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
    },
  });
});

export { auth };
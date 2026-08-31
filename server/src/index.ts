import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth/routes.js";
import { metadata } from "./metadata/routes.js";
import { downloads } from "./downloads/routes.js";
import { files } from "./files/routes.js";
import { verifySessionCookie, type SessionPayload } from "./auth/index.js";

interface Env {
  Variables: {
    session: SessionPayload;
  };
}

const app = new Hono<Env>();

app.use("*", cors({
  origin: process.env.PUBLIC_APP_URL || "http://localhost:5173",
  credentials: true,
}));

app.use("/api/*", async (c, next) => {
  const token = c.req.header("Cookie")?.split("youwee_session=")[1]?.split(";")[0];

  if (token) {
    const session = await verifySessionCookie(token);
    if (session) {
      c.set("session", session);
    }
  }

  await next();
});

app.get("/api/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.route("/api/auth", auth);
app.route("/api/metadata", metadata);
app.route("/api/downloads", downloads);
app.route("/api/files", files);

export default app;
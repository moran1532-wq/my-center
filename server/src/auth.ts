import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export type Role = "owner" | "member";
export interface Viewer { email: string; role: Role }

declare module "express-serve-static-core" {
  interface Request { viewer?: Viewer }
}

/**
 * Who is asking.
 * - AUTH_MODE=proxy: the company's internal system sits in front of this server, signs users in, and passes
 *   X-User-Email + X-User-Role ("owner" = knowledge owner, anything else = team member), plus X-Auth-Secret
 *   equal to AUTH_PROXY_SECRET so nobody can fake those headers by calling the server directly.
 * - AUTH_MODE=dev: everyone is a knowledge owner. Refused when NODE_ENV=production.
 * - not set: every request is refused. Safe by default.
 */
export function authFromEnv(env = process.env) {
  const mode = env.AUTH_MODE;
  if (mode === "dev" && env.NODE_ENV === "production") throw new Error("AUTH_MODE=dev is not allowed in production");
  if (mode === "proxy" && (!env.AUTH_PROXY_SECRET || env.AUTH_PROXY_SECRET.length < 16)) {
    throw new Error("AUTH_MODE=proxy needs AUTH_PROXY_SECRET (16+ characters)");
  }
  const secret = Buffer.from(env.AUTH_PROXY_SECRET ?? "");

  return (req: Request, res: Response, next: NextFunction) => {
    if (mode === "dev") {
      req.viewer = { email: "dev@localhost", role: "owner" };
      return next();
    }
    if (mode === "proxy") {
      const given = Buffer.from(String(req.get("x-auth-secret") ?? ""));
      const email = String(req.get("x-user-email") ?? "").trim();
      if (given.length !== secret.length || !timingSafeEqual(given, secret) || !email) {
        return res.status(401).json({ error: "not_signed_in" });
      }
      req.viewer = { email, role: req.get("x-user-role") === "owner" ? "owner" : "member" };
      return next();
    }
    res.status(401).json({ error: "auth_not_configured" });
  };
}

/** Knowledge-owner actions: uploading, "not a gap", report recipients, generating reports. */
export function ownerOnly(req: Request, res: Response, next: NextFunction) {
  if (req.viewer?.role !== "owner") return res.status(403).json({ error: "owners_only" });
  next();
}

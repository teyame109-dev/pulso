import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyAccess } from "./security.js";
import { repo, type Role } from "./db.js";

declare module "fastify" {
  interface FastifyRequest { userId?: string; emailVerified?: boolean; role?: Role; }
}

// Exige un access token válido en Authorization: Bearer <token>.
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "no_autenticado", message: "Falta el token de acceso." });
  }
  try {
    const { sub, ev, role } = verifyAccess(h.slice(7));
    req.userId = sub; req.emailVerified = ev; req.role = role as Role;
  } catch {
    return reply.code(401).send({ error: "token_invalido", message: "El token no es válido o ha caducado." });
  }
}

// Exige email verificado (fuente de verdad: BBDD).
export async function requireVerified(req: FastifyRequest, reply: FastifyReply) {
  const u = req.userId ? repo.getUserById(req.userId) : undefined;
  if (!u || !u.email_verified) {
    return reply.code(403).send({ error: "email_no_verificado", message: "Verifica tu correo para continuar." });
  }
}

// Exige uno de los roles indicados (se relee de BBDD para evitar tokens obsoletos).
export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const u = req.userId ? repo.getUserById(req.userId) : undefined;
    if (!u || !roles.includes(u.role)) {
      return reply.code(403).send({ error: "no_autorizado", message: "No tienes permiso para esta acción." });
    }
    req.role = u.role;
  };
}

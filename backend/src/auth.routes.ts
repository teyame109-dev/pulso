import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomBytes, randomUUID } from "node:crypto";
import { repo } from "./db.js";
import {
  hashPassword, verifyPassword, signAccess, signRefresh, verifyRefresh, sha256,
  generateTotpSecret, totpVerify, otpauthUri, generateBackupCodes,
  signTwofaChallenge, verifyTwofaChallenge, encryptPHI, decryptPHI,
} from "./security.js";
import { config, isProd } from "./env.js";
import { requireAuth } from "./middleware.js";
import { mailer } from "./mailer.js";
import QRCode from "qrcode";

const credentials = z.object({
  email: z.string().email().max(254).transform((s) => s.toLowerCase()),
  password: z.string().min(8).max(200),
});

function issueRefresh(userId: string) {
  const jti = randomUUID();
  const token = signRefresh(userId, jti);
  const expires = new Date(Date.now() + config.refreshTtlDays * 864e5).toISOString();
  repo.saveRefresh(jti, userId, sha256(token), expires); // id = jti; guardamos solo el hash
  return { token, jti };
}

export async function authRoutes(app: FastifyInstance) {
  // ── Registro ──
  app.post("/v1/auth/register", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = credentials.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "datos_invalidos", issues: parsed.error.issues });
    const { email, password } = parsed.data;

    if (repo.getUserByEmail(email)) {
      return reply.code(409).send({ error: "email_en_uso", message: "Ya existe una cuenta con ese correo." });
    }
    const verifyToken = randomBytes(24).toString("hex");
    const verifyExpires = new Date(Date.now() + config.verifyTtlHours * 3600_000).toISOString();
    const user = repo.createUser(email, hashPassword(password), verifyToken, verifyExpires);

    const link = await mailer.sendVerification(user.email, "", verifyToken, (m) => req.log.info(m));

    const body: Record<string, unknown> = {
      user: { id: user.id, email: user.email, emailVerified: false },
      message: "Te hemos enviado un correo para verificar tu cuenta.",
    };
    if (!isProd) body._demo_verifyUrl = link; // solo fuera de producción, para pruebas
    return reply.code(201).send(body);
  });

  // ── Reenviar verificación ──
  app.post("/v1/auth/resend-verification", { config: { rateLimit: { max: 3, timeWindow: "5 minutes" } } }, async (req, reply) => {
    const { email } = z.object({ email: z.string().email().transform((s) => s.toLowerCase()) }).parse(req.body);
    const user = repo.getUserByEmail(email);
    // Respuesta genérica: no revelamos si el email existe.
    if (user && !user.email_verified) {
      const token = randomBytes(24).toString("hex");
      const expires = new Date(Date.now() + config.verifyTtlHours * 3600_000).toISOString();
      repo.setVerifyToken(user.id, token, expires);
      await mailer.sendVerification(user.email, "", token, (m) => req.log.info(m));
    }
    return reply.send({ message: "Si la cuenta existe y no está verificada, te hemos reenviado el correo." });
  });

  // ── Verificación por enlace (clic desde el email) → redirige a la app ──
  app.get("/v1/auth/verify-email", async (req, reply) => {
    const token = (req.query as any)?.token as string | undefined;
    const base = config.appUrl.replace(/\/$/, "");
    if (!token) return reply.redirect(`${base}/verificado?status=invalid`);
    const r = repo.verifyEmail(token);
    const status = r.ok ? "ok" : r.reason; // ok | expired | invalid
    return reply.redirect(`${base}/verificado?status=${status}`);
  });

  // ── Verificación vía API (SPA que captura el token del enlace) ──
  app.post("/v1/auth/verify-email", async (req, reply) => {
    const { token } = z.object({ token: z.string() }).parse(req.body);
    const r = repo.verifyEmail(token);
    if (!r.ok) {
      const msg = r.reason === "expired" ? "El enlace de verificación ha caducado." : "Enlace de verificación no válido.";
      return reply.code(400).send({ error: r.reason === "expired" ? "token_caducado" : "token_invalido", message: msg });
    }
    return reply.send({ user: { id: r.user!.id, email: r.user!.email, emailVerified: true } });
  });

  // ── Login ──
  app.post("/v1/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = credentials.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "datos_invalidos" });
    const { email, password } = parsed.data;

    const user = repo.getUserByEmail(email);
    // Mensaje genérico para no revelar si el email existe.
    if (!user || !verifyPassword(password, user.password_hash)) {
      return reply.code(401).send({ error: "credenciales", message: "Correo o contraseña incorrectos." });
    }

    // Si el usuario tiene 2FA activo, no emitimos tokens todavía: devolvemos un desafío.
    if (user.twofa_enabled) {
      return reply.send({ twofaRequired: true, challengeToken: signTwofaChallenge(user.id) });
    }

    const access = signAccess(user.id, !!user.email_verified, user.role);
    const { token: refresh } = issueRefresh(user.id);
    const profile = repo.getProfile(user.id);
    // Si su rol exige 2FA y aún no la tiene, se lo indicamos para forzar la configuración.
    const mustSetup2fa = config.require2faRoles.includes(user.role);
    return reply.send({
      accessToken: access,
      refreshToken: refresh,
      mustSetup2fa,
      user: { id: user.id, email: user.email, role: user.role, emailVerified: !!user.email_verified, hasProfile: !!profile },
    });
  });

  // ── Refresh con rotación ──
  app.post("/v1/auth/refresh", async (req, reply) => {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);
    let payload;
    try { payload = verifyRefresh(refreshToken); }
    catch { return reply.code(401).send({ error: "refresh_invalido" }); }

    const row = repo.findRefresh(payload.jti);
    // El jti se guarda como id del registro.
    const byHash = row && row.token_hash === sha256(refreshToken);
    if (!row || row.revoked || !byHash || new Date(row.expires_at) < new Date()) {
      // Posible reuso de token: revocamos toda la familia por seguridad.
      if (row) repo.revokeAllRefresh(row.user_id);
      return reply.code(401).send({ error: "refresh_invalido", message: "Sesión no válida, vuelve a iniciar sesión." });
    }
    repo.revokeRefresh(row.id);
    const u = repo.getUserById(row.user_id);
    const access = signAccess(row.user_id, !!u?.email_verified, u?.role ?? "patient");
    const { token: newRefresh } = issueRefresh(row.user_id);
    return reply.send({ accessToken: access, refreshToken: newRefresh });
  });

  // ── Logout ──
  app.post("/v1/auth/logout", async (req, reply) => {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);
    try {
      const { jti } = verifyRefresh(refreshToken);
      const row = repo.findRefresh(jti);
      if (row) repo.revokeRefresh(row.id);
    } catch { /* token ya inválido: nada que hacer */ }
    return reply.send({ ok: true });
  });

  // ── Usuario actual ──
  app.get("/v1/auth/me", { preHandler: requireAuth }, async (req, reply) => {
    const user = repo.getUserById(req.userId!);
    if (!user) return reply.code(404).send({ error: "no_encontrado" });
    const profile = repo.getProfile(user.id);
    return reply.send({
      user: { id: user.id, email: user.email, role: user.role, emailVerified: !!user.email_verified, hasProfile: !!profile },
    });
  });

  // ── Aceptar invitación de médico (fijar contraseña) ──
  app.post("/v1/auth/accept-invite", async (req, reply) => {
    const { token, password } = z.object({ token: z.string(), password: z.string().min(8).max(200) }).parse(req.body);
    const r = repo.acceptInvite(token, hashPassword(password));
    if (!r.ok) {
      const expired = r.reason === "expired";
      return reply.code(400).send({
        error: expired ? "invitacion_caducada" : "invitacion_invalida",
        message: expired ? "La invitación ha caducado. Pide una nueva al administrador." : "Invitación no válida.",
      });
    }
    return reply.send({ ok: true, user: { id: r.user!.id, email: r.user!.email, role: r.user!.role } });
  });

  // ── 2FA · iniciar configuración (genera secreto y QR) ──
  app.post("/v1/auth/2fa/setup", { preHandler: requireAuth }, async (req, reply) => {
    const user = repo.getUserById(req.userId!);
    if (!user) return reply.code(404).send({ error: "no_encontrado" });
    if (user.twofa_enabled) return reply.code(409).send({ error: "2fa_ya_activo", message: "El 2FA ya está activado." });

    const secret = generateTotpSecret();
    repo.setTwofaSecret(user.id, encryptPHI(secret)); // secreto cifrado en reposo
    const uri = otpauthUri(user.email, secret);
    const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1 });
    return reply.send({
      secret,            // por si el usuario lo introduce a mano
      otpauthUri: uri,   // para generar el QR en el cliente
      qrSvg,             // QR ya renderizado (SVG)
      message: "Escanea el QR con tu app de autenticación y confirma con un código.",
    });
  });

  // ── 2FA · activar (confirma con un código y entrega códigos de respaldo) ──
  app.post("/v1/auth/2fa/enable", { preHandler: requireAuth }, async (req, reply) => {
    const { code } = z.object({ code: z.string().min(6).max(9) }).parse(req.body);
    const user = repo.getUserById(req.userId!);
    if (!user || !user.twofa_secret_enc) return reply.code(400).send({ error: "sin_configurar", message: "Inicia la configuración primero." });
    const secret = decryptPHI<string>(user.twofa_secret_enc);
    if (!totpVerify(secret, code)) return reply.code(400).send({ error: "codigo_invalido", message: "El código no es válido." });

    repo.enableTwofa(user.id);
    const { plain, hashes } = generateBackupCodes(8);
    repo.saveBackupCodes(user.id, hashes);
    return reply.send({
      ok: true,
      backupCodes: plain, // se muestran UNA vez; guárdalos en lugar seguro
      message: "2FA activado. Guarda tus códigos de respaldo.",
    });
  });

  // ── 2FA · verificar en el login (tras el desafío) ──
  app.post("/v1/auth/2fa/verify", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { challengeToken, code } = z.object({ challengeToken: z.string(), code: z.string().min(6).max(9) }).parse(req.body);
    let userId: string;
    try { userId = verifyTwofaChallenge(challengeToken).sub; }
    catch { return reply.code(401).send({ error: "desafio_invalido", message: "Vuelve a iniciar sesión." }); }

    const user = repo.getUserById(userId);
    if (!user || !user.twofa_enabled || !user.twofa_secret_enc) return reply.code(400).send({ error: "2fa_no_activo" });
    const secret = decryptPHI<string>(user.twofa_secret_enc);

    const isTotp = /^\d{6}$/.test(code);
    const ok = isTotp ? totpVerify(secret, code) : repo.consumeBackupCode(user.id, sha256(code));
    if (!ok) return reply.code(401).send({ error: "codigo_invalido", message: "Código incorrecto." });

    const access = signAccess(user.id, !!user.email_verified, user.role);
    const { token: refresh } = issueRefresh(user.id);
    const profile = repo.getProfile(user.id);
    return reply.send({
      accessToken: access,
      refreshToken: refresh,
      usedBackupCode: !isTotp,
      remainingBackupCodes: repo.countBackupCodes(user.id),
      user: { id: user.id, email: user.email, role: user.role, emailVerified: !!user.email_verified, hasProfile: !!profile },
    });
  });

  // ── 2FA · desactivar ──
  app.post("/v1/auth/2fa/disable", { preHandler: requireAuth }, async (req, reply) => {
    const { code } = z.object({ code: z.string().min(6).max(9) }).parse(req.body);
    const user = repo.getUserById(req.userId!);
    if (!user || !user.twofa_enabled || !user.twofa_secret_enc) return reply.code(400).send({ error: "2fa_no_activo" });
    const secret = decryptPHI<string>(user.twofa_secret_enc);
    const ok = /^\d{6}$/.test(code) ? totpVerify(secret, code) : repo.consumeBackupCode(user.id, sha256(code));
    if (!ok) return reply.code(401).send({ error: "codigo_invalido", message: "Código incorrecto." });
    repo.disableTwofa(user.id);
    return reply.send({ ok: true, message: "2FA desactivado." });
  });
}

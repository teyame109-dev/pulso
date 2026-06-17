import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { repo, type DoctorRow } from "./db.js";
import { hashPassword } from "./security.js";
import { requireAuth, requireRole } from "./middleware.js";
import { mailer } from "./mailer.js";
import { config, isProd } from "./env.js";

const adminView = (d: DoctorRow & { email: string }) => ({
  id: d.user_id,
  email: d.email,
  fullName: d.full_name,
  specialty: d.specialty,
  licenseNumber: d.license_number,
  licenseStatus: d.license_status,
  availability: d.availability,
  rating: d.rating,
  consultations: d.consultations,
  createdAt: d.created_at,
});

export async function adminRoutes(app: FastifyInstance) {
  const adminOnly = { preHandler: [requireAuth, requireRole("admin")] };

  // ── Alta de médico por invitación ──
  app.post("/v1/admin/doctors", adminOnly, async (req, reply) => {
    const body = z.object({
      email: z.string().email().transform((s) => s.toLowerCase()),
      fullName: z.string().min(1).max(120),
      specialty: z.string().min(1).max(80),
      licenseNumber: z.string().min(1).max(40),
    }).parse(req.body);

    if (repo.getUserByEmail(body.email)) {
      return reply.code(409).send({ error: "email_en_uso", message: "Ya existe una cuenta con ese correo." });
    }

    // Contraseña temporal aleatoria (nunca se comunica): el médico fijará la suya al aceptar.
    const tempHash = hashPassword(randomBytes(24).toString("hex"));
    const inviteToken = randomBytes(24).toString("hex");
    const inviteExpires = new Date(Date.now() + config.verifyTtlHours * 3600_000).toISOString();

    const user = repo.createDoctorAccount({
      email: body.email, tempHash, inviteToken, inviteExpires,
      fullName: body.fullName, specialty: body.specialty, licenseNumber: body.licenseNumber,
    });

    const link = await mailer.sendInvitation(body.email, body.fullName, body.specialty, inviteToken, (m) => req.log.info(m));

    const res: Record<string, unknown> = {
      doctor: adminView({ ...repo.getDoctor(user.id)!, email: user.email }),
      message: "Invitación enviada al médico.",
    };
    if (!isProd) res._demo_inviteUrl = link;
    return reply.code(201).send(res);
  });

  // ── Listado de médicos (panel) ──
  app.get("/v1/admin/doctors", adminOnly, async (_req, reply) => {
    return reply.send({ doctors: repo.listDoctorsAdmin().map(adminView) });
  });

  // ── Verificación de colegiación ──
  app.put("/v1/admin/doctors/:id/license", adminOnly, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { status } = z.object({ status: z.enum(["verified", "rejected", "pending"]) }).parse(req.body);
    const d = repo.getDoctor(id);
    if (!d) return reply.code(404).send({ error: "no_encontrado", message: "Médico no encontrado." });
    const updated = repo.setLicenseStatus(id, status);
    return reply.send({ id, licenseStatus: updated!.license_status, availability: updated!.availability });
  });

  // Métricas para el panel de dirección.
  app.get("/v1/admin/metrics", { preHandler: [requireAuth, requireRole("admin")] }, async (req, reply) => {
    const period = ((req.query as any)?.period as string) || "30d";
    const since = period === "today"
      ? new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
      : new Date(Date.now() - (period === "7d" ? 7 : 30) * 86400 * 1000).toISOString();
    return reply.send({ period, metrics: repo.metrics(since) });
  });
}

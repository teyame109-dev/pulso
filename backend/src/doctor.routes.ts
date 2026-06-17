import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { repo, type DoctorRow } from "./db.js";
import { requireAuth, requireRole } from "./middleware.js";
import { encryptPHI, decryptPHI } from "./security.js";
import { config } from "./env.js";
import { writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const publicView = (d: DoctorRow) => ({
  id: d.user_id,
  fullName: d.full_name,
  specialty: d.specialty,
  bio: d.bio,
  languages: JSON.parse(d.languages || "[]"),
  rating: d.rating,
  consultations: d.consultations,
  availability: d.availability,
});

function maskIban(enc: string | null): string | null {
  if (!enc) return null;
  try { const iban = decryptPHI<string>(enc); return "•••• " + iban.replace(/\s/g, "").slice(-4); } catch { return null; }
}

const selfView = (d: DoctorRow) => ({
  ...publicView(d),
  licenseNumber: d.license_number,
  licenseStatus: d.license_status,
  lastSeen: d.last_seen,
  onboardingComplete: !!d.onboarding_complete,
  degreeTitle: d.degree_title,
  insurer: d.insurer,
  policyNumber: d.policy_number,
  policyExpiry: d.policy_expiry,
  ibanMasked: maskIban(d.bank_iban_enc),
  documents: repo.listDoctorDocuments(d.user_id).map((x) => ({ id: x.id, type: x.type, original: x.original, size: x.size, uploadedAt: x.uploaded_at })),
});

export async function doctorRoutes(app: FastifyInstance) {
  // ── Perfil del médico (su propia ficha) ──
  app.get("/v1/doctors/me", { preHandler: [requireAuth, requireRole("doctor")] }, async (req, reply) => {
    const d = repo.getDoctor(req.userId!);
    if (!d) return reply.code(404).send({ error: "sin_perfil" });
    return reply.send({ doctor: selfView(d) });
  });

  // ── Editar bio e idiomas (especialidad y colegiado los gestiona el admin) ──
  app.put("/v1/doctors/me/profile", { preHandler: [requireAuth, requireRole("doctor")] }, async (req, reply) => {
    const body = z.object({
      bio: z.string().max(1000).optional(),
      languages: z.array(z.string().max(30)).max(10).optional(),
    }).parse(req.body);
    const d = repo.updateDoctorProfile(req.userId!, body);
    if (!d) return reply.code(404).send({ error: "sin_perfil" });
    return reply.send({ doctor: selfView(d) });
  });

  // ── Disponibilidad (solo con colegiación verificada) ──
  app.put("/v1/doctors/me/availability", { preHandler: [requireAuth, requireRole("doctor")] }, async (req, reply) => {
    const { status } = z.object({ status: z.enum(["online", "pausa", "offline"]) }).parse(req.body);
    const d = repo.getDoctor(req.userId!);
    if (!d) return reply.code(404).send({ error: "sin_perfil" });
    if (d.license_status !== "verified") {
      return reply.code(403).send({
        error: "colegiacion_no_verificada",
        message: "Tu colegiación aún no está verificada; no puedes ponerte disponible.",
      });
    }
    const updated = repo.setAvailability(req.userId!, status);
    return reply.send({ availability: updated!.availability });
  });

  // ── Alta / onboarding del médico: titulación, seguro y datos bancarios ──
  app.post("/v1/doctors/me/onboarding", { preHandler: [requireAuth, requireRole("doctor")] }, async (req, reply) => {
    const b = z.object({
      degreeTitle: z.string().min(1).max(160),
      insurer: z.string().min(1).max(120),
      policyNumber: z.string().min(1).max(80),
      policyExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      iban: z.string().min(15).max(34),
      holder: z.string().min(1).max(120),
    }).parse(req.body);
    const d = repo.updateDoctorOnboarding(req.userId!, {
      degree_title: b.degreeTitle, insurer: b.insurer, policy_number: b.policyNumber, policy_expiry: b.policyExpiry,
      bank_iban_enc: encryptPHI(b.iban.replace(/\s/g, "").toUpperCase()), // IBAN cifrado en reposo
      bank_holder_enc: encryptPHI(b.holder),
    });
    if (!d) return reply.code(404).send({ error: "sin_perfil" });
    return reply.send({ doctor: selfView(d) });
  });

  // ── Subida de documentos (titulación, seguro) ──
  app.post("/v1/doctors/me/documents", { preHandler: [requireAuth, requireRole("doctor")] }, async (req, reply) => {
    const file = await (req as any).file();
    if (!file) return reply.code(400).send({ error: "sin_archivo" });
    const type = (file.fields?.type?.value as string) || "titulacion";
    if (!["titulacion", "seguro"].includes(type)) return reply.code(400).send({ error: "tipo_invalido" });

    const buf = await file.toBuffer();
    if (buf.length > 8 * 1024 * 1024) return reply.code(413).send({ error: "archivo_grande", message: "Máximo 8 MB." });
    const dir = join(config.uploadDir, req.userId!);
    await mkdir(dir, { recursive: true });
    const storedName = `${type}_${randomUUID().slice(0, 8)}_${file.filename}`;
    await writeFile(join(dir, storedName), buf); // en producción: S3 UE cifrado
    const doc = repo.addDoctorDocument(req.userId!, type, storedName, file.filename, file.mimetype, buf.length);
    return reply.code(201).send({ document: { id: doc.id, type: doc.type, original: doc.original, size: doc.size } });
  });

  // ── Liquidaciones del médico, acotadas por fechas ──
  app.get("/v1/doctor/earnings", { preHandler: [requireAuth, requireRole("doctor")] }, async (req, reply) => {
    const q = req.query as { from?: string; to?: string };
    const from = q.from ? new Date(q.from).toISOString() : new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    const to = q.to ? new Date(q.to + "T23:59:59").toISOString() : new Date().toISOString();
    const rows = repo.listEarnings(req.userId!, from, to);
    const totals = repo.earningsTotals(req.userId!, from, to);
    const items = rows.map((e) => ({
      id: e.id, date: e.created_at, grossCents: e.gross_cents, feeCents: e.fee_cents, netCents: e.net_cents, status: e.status,
    }));
    return reply.send({
      from, to,
      payoutPct: config.doctorPayoutPct,
      totals: { count: totals.n, grossCents: totals.gross, feeCents: totals.fee, netCents: totals.net },
      items,
    });
  });

  // ── Listado de médicos (para el matching del paciente) ──
  // GET /v1/doctors?specialty=Dermatología&available=true
  app.get("/v1/doctors", { preHandler: requireAuth }, async (req, reply) => {
    const q = req.query as { specialty?: string; available?: string };
    const list = repo.listDoctorsPublic({
      specialty: q.specialty,
      available: q.available === "true",
    });
    return reply.send({ doctors: list.map(publicView) });
  });
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { repo, type PrescriptionRow } from "./db.js";
import { encryptPHI, decryptPHI, sha256 } from "./security.js";
import { requireAuth, requireRole } from "./middleware.js";

const itemSchema = z.object({
  medication: z.string().min(1).max(160),
  dose: z.string().max(80).default(""),
  posology: z.string().min(1).max(200),   // p. ej. "1 comprimido cada 8 h"
  duration: z.string().max(80).default(""),
  notes: z.string().max(300).default(""),
});

// Folio legible y único de la receta (en producción lo asigna la plataforma homologada).
const newCode = () => "RX-" + randomBytes(4).toString("hex").toUpperCase();

// Documento completo de la receta (datos para pintar/imprimir).
function buildDocument(p: PrescriptionRow) {
  const doctor = repo.getDoctor(p.doctor_id);
  const prof = repo.getProfile(p.patient_id);
  const patientName = prof ? (decryptPHI<any>(prof.data_enc)?.name ?? "Paciente") : "Paciente";
  return {
    id: p.id,
    code: p.code,
    status: p.status,
    issuedAt: p.issued_at,
    items: decryptPHI<any[]>(p.items_enc),
    signature: p.signature,
    doctor: doctor ? { name: doctor.full_name, specialty: doctor.specialty, license: doctor.license_number } : null,
    patient: { name: patientName },
  };
}

export async function prescriptionRoutes(app: FastifyInstance) {
  // ── Médico emite la receta de una consulta ──
  app.post("/v1/consultations/:id/prescription", { preHandler: [requireAuth, requireRole("doctor")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { items } = z.object({ items: z.array(itemSchema).min(1).max(20) }).parse(req.body);

    const c = repo.getConsultation(id);
    if (!c || c.doctor_id !== req.userId) return reply.code(404).send({ error: "no_encontrada" });
    if (!["assigned", "in_progress", "completed"].includes(c.status)) {
      return reply.code(409).send({ error: "estado_invalido", message: "La consulta no admite receta en su estado actual." });
    }
    if (repo.getPrescriptionByConsultation(id)) {
      return reply.code(409).send({ error: "receta_existente", message: "Esta consulta ya tiene una receta." });
    }

    const code = newCode();
    const issuedAt = new Date().toISOString();
    // Sello de integridad. En producción: firma electrónica cualificada del médico.
    const signature = sha256(`${code}|${req.userId}|${c.patient_id}|${JSON.stringify(items)}|${issuedAt}`);
    const presc = repo.createPrescription(id, c.patient_id, req.userId!, code, encryptPHI(items), signature);
    repo.logAccess(id, req.userId!, c.patient_id, "prescription_issued");

    return reply.code(201).send({ prescription: buildDocument(presc) });
  });

  // ── Ver la receta de una consulta (paciente dueño o médico asignado) ──
  app.get("/v1/consultations/:id/prescription", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = repo.getConsultation(id);
    if (!c) return reply.code(404).send({ error: "no_encontrada" });
    if (req.userId !== c.patient_id && req.userId !== c.doctor_id) return reply.code(403).send({ error: "no_autorizado" });
    const p = repo.getPrescriptionByConsultation(id);
    if (!p) return reply.code(404).send({ error: "sin_receta", message: "Esta consulta no tiene receta." });
    return reply.send({ prescription: buildDocument(p) });
  });

  // ── Mis recetas (paciente) ──
  app.get("/v1/prescriptions/me", { preHandler: [requireAuth, requireRole("patient")] }, async (req, reply) => {
    const list = repo.listPrescriptionsByPatient(req.userId!).map((p) => {
      const doc = repo.getDoctor(p.doctor_id);
      const items = decryptPHI<any[]>(p.items_enc);
      return { id: p.id, code: p.code, issuedAt: p.issued_at, status: p.status,
        doctor: doc ? doc.full_name : null, medications: items.map((i) => i.medication) };
    });
    return reply.send({ prescriptions: list });
  });

  // ── Documento de una receta concreta (dueño o emisor) ──
  app.get("/v1/prescriptions/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = repo.getPrescription(id);
    if (!p) return reply.code(404).send({ error: "no_encontrada" });
    if (req.userId !== p.patient_id && req.userId !== p.doctor_id) return reply.code(403).send({ error: "no_autorizado" });
    return reply.send({ prescription: buildDocument(p) });
  });
}

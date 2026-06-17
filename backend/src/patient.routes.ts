import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { repo } from "./db.js";
import { encryptPHI, decryptPHI } from "./security.js";
import { requireAuth, requireVerified } from "./middleware.js";

// Cuestionario médico. Los campos clínicos se cifran antes de guardarse.
const profileSchema = z.object({
  name: z.string().min(1).max(120),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sex: z.enum(["Mujer", "Hombre", "Intersexual"]),
  height: z.number().int().positive().max(260).nullable().optional(),
  weight: z.number().positive().max(400).nullable().optional(),
  chronic: z.array(z.string()).max(30).default([]),
  surgeries: z.string().max(2000).default(""),
  allergies: z.array(z.string()).max(30).default([]),
  meds: z.string().max(2000).default(""),
  smoke: z.string().max(40).default(""),
  alcohol: z.string().max(40).default(""),
  exercise: z.string().max(40).default(""),
  consent: z.object({
    assist: z.boolean(),
    terms: z.boolean(),
    reco: z.boolean().default(false),
  }),
});

export async function patientRoutes(app: FastifyInstance) {
  // ── Guardar / actualizar el cuestionario clínico ──
  app.put("/v1/patients/me/profile", { preHandler: [requireAuth, requireVerified] }, async (req, reply) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "datos_invalidos", issues: parsed.error.issues });
    const { consent, ...clinical } = parsed.data;

    // El consentimiento asistencial y los términos son obligatorios (base jurídica RGPD art. 9).
    if (!consent.assist || !consent.terms) {
      return reply.code(422).send({
        error: "consentimiento_requerido",
        message: "Se requiere el consentimiento asistencial y la aceptación de términos.",
      });
    }

    const dataEnc = encryptPHI(clinical); // cifrado en reposo
    repo.upsertProfile(req.userId!, dataEnc, consent);
    return reply.code(200).send({ ok: true, consent });
  });

  // ── Recuperar el perfil (descifrado solo para su titular) ──
  app.get("/v1/patients/me/profile", { preHandler: requireAuth }, async (req, reply) => {
    const row = repo.getProfile(req.userId!);
    if (!row) return reply.code(404).send({ error: "sin_perfil", message: "Aún no has completado el cuestionario." });
    const clinical = decryptPHI(row.data_enc);
    return reply.send({
      profile: clinical,
      consent: { assist: !!row.consent_assist, terms: !!row.consent_terms, reco: !!row.consent_reco },
      updatedAt: row.updated_at,
    });
  });

  // ── Historial del paciente: perfil + consultas + recetas ──
  app.get("/v1/patients/me/history", { preHandler: [requireAuth, requireVerified] }, async (req, reply) => {
    const uid = req.userId!;
    const row = repo.getProfile(uid);
    const profile = row
      ? { ...decryptPHI<any>(row.data_enc), consent: { assist: !!row.consent_assist, terms: !!row.consent_terms, reco: !!row.consent_reco }, updatedAt: row.updated_at }
      : null;

    const consultations = repo.listConsultationsByPatient(uid).map((c) => {
      const doctor = c.doctor_id ? repo.getDoctor(c.doctor_id) : undefined;
      const presc = repo.getPrescriptionByConsultation(c.id);
      return {
        id: c.id, specialty: c.specialty, status: c.status,
        reason: decryptPHI<string>(c.reason_enc),
        summary: c.status === "completed" && c.summary_enc ? decryptPHI<string>(c.summary_enc) : null,
        doctor: doctor ? doctor.full_name : null,
        createdAt: c.created_at, completedAt: c.completed_at,
        hasPrescription: !!presc,
        prescriptionId: presc ? presc.id : null,
      };
    });

    const prescriptions = repo.listPrescriptionsByPatient(uid).map((p) => {
      const doc = repo.getDoctor(p.doctor_id);
      const items = decryptPHI<any[]>(p.items_enc);
      return { id: p.id, code: p.code, issuedAt: p.issued_at, status: p.status,
        doctor: doc ? doc.full_name : null, medications: items.map((i) => i.medication) };
    });

    return reply.send({ profile, consultations, prescriptions });
  });

  // ── Supresión RGPD (derecho al olvido) ──
  app.delete("/v1/patients/me", { preHandler: requireAuth }, async (req, reply) => {
    repo.deleteUser(req.userId!); // cascada: perfil + tokens
    return reply.send({ ok: true, message: "Cuenta y datos eliminados." });
  });
}

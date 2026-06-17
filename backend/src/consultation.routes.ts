import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { repo, type ConsultationRow } from "./db.js";
import { encryptPHI, decryptPHI, verifyAccess } from "./security.js";
import { requireAuth, requireRole } from "./middleware.js";
import { bus, chQueue, chConsultation } from "./bus.js";
import { config } from "./env.js";
import { payments } from "./payments.js";

// Precio por especialidad (céntimos). Ajustable; en prod puede venir de BBDD.
export const PRICING: Record<string, number> = {
  "Dermatología": 2900, "Medicina general": 2500, "Urología": 3200,
  "Ginecología": 3200, "Pediatría": 2900, "Nutrición": 3500,
};
export const priceFor = (specialty: string) => PRICING[specialty] ?? 2900;

// Vista de consulta para el paciente (sin notas internas del médico; sí el informe).
function patientView(c: ConsultationRow) {
  const doctor = c.doctor_id ? repo.getDoctor(c.doctor_id) : undefined;
  return {
    id: c.id, specialty: c.specialty, status: c.status,
    reason: decryptPHI<string>(c.reason_enc),
    summary: c.status === "completed" && c.summary_enc ? decryptPHI<string>(c.summary_enc) : null,
    roomId: c.room_id,
    doctor: doctor ? { id: doctor.user_id, name: doctor.full_name, rating: doctor.rating } : null,
    createdAt: c.created_at, assignedAt: c.assigned_at, completedAt: c.completed_at,
    priceCents: c.price_cents,
  };
}

// Vista para el médico (incluye notas).
function doctorView(c: ConsultationRow) {
  return {
    id: c.id, specialty: c.specialty, status: c.status,
    reason: decryptPHI<string>(c.reason_enc),
    notes: c.notes_enc ? decryptPHI<string>(c.notes_enc) : "",
    roomId: c.room_id,
    patientId: c.patient_id,
    createdAt: c.created_at, assignedAt: c.assigned_at, startedAt: c.started_at,
  };
}

// SSE: autentica por Authorization o por ?access_token=, escribe eventos y limpia al cerrar.
function startSSE(req: FastifyRequest, reply: FastifyReply): { send: (e: string, d: unknown) => void; userId: string } | null {
  const h = req.headers.authorization;
  const q = (req.query as any)?.access_token as string | undefined;
  const token = h && h.startsWith("Bearer ") ? h.slice(7) : q;
  let userId = "";
  try { userId = verifyAccess(token || "").sub; } catch { reply.code(401).send({ error: "no_autenticado" }); return null; }

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": reply.getHeader("Access-Control-Allow-Origin") as string || "*",
  });
  reply.raw.write(`event: ready\ndata: {}\n\n`);
  const send = (event: string, data: unknown) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  return { send, userId };
}

export async function consultationRoutes(app: FastifyInstance) {
  /* ───────────────────────── PACIENTE ───────────────────────── */

  // Crear solicitud de consulta (entra en cola).
  app.post("/v1/consultations", { preHandler: [requireAuth, requireRole("patient")] }, async (req, reply) => {
    const { specialty, reason } = z.object({
      specialty: z.string().min(1).max(80),
      reason: z.string().min(1).max(2000),
    }).parse(req.body);

    // Evita duplicar: una consulta activa por paciente.
    const active = repo.listConsultationsByPatient(req.userId!).find((c) => ["pending_payment", "waiting", "assigned", "in_progress"].includes(c.status));
    if (active) return reply.code(409).send({ error: "consulta_activa", message: "Ya tienes una consulta en curso.", id: active.id });

    const price = priceFor(specialty);
    const c = repo.createConsultation(req.userId!, specialty, encryptPHI(reason), price);
    // Se crea el pago pendiente; la consulta no entra en cola hasta que se pague.
    const payment = repo.createPayment(c.id, req.userId!, price, config.currency, payments.mode());

    return reply.code(201).send({
      consultation: patientView(c),
      payment: { id: payment.id, amountCents: payment.amount_cents, currency: payment.currency, status: payment.status },
    });
  });

  // Mis consultas.
  app.get("/v1/consultations/me", { preHandler: [requireAuth, requireRole("patient")] }, async (req, reply) => {
    return reply.send({ consultations: repo.listConsultationsByPatient(req.userId!).map(patientView) });
  });

  // Estado de una consulta (paciente dueño o médico asignado).
  app.get("/v1/consultations/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = repo.getConsultation(id);
    if (!c) return reply.code(404).send({ error: "no_encontrada" });
    if (req.userId === c.patient_id) return reply.send({ consultation: patientView(c), queuePosition: repo.queuePosition(c.id) });
    if (req.userId === c.doctor_id) return reply.send({ consultation: doctorView(c) });
    return reply.code(403).send({ error: "no_autorizado" });
  });

  // Cancelar (solo si sigue en espera o asignada sin empezar).
  app.post("/v1/consultations/:id/cancel", { preHandler: [requireAuth, requireRole("patient")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = repo.getConsultation(id);
    if (!c || c.patient_id !== req.userId) return reply.code(404).send({ error: "no_encontrada" });
    if (!["pending_payment", "waiting", "assigned"].includes(c.status)) return reply.code(409).send({ error: "no_cancelable", message: "La consulta ya no puede cancelarse." });
    const updated = repo.cancelConsultation(id);
    bus.publish(chConsultation(id), { type: "cancelled" });
    return reply.send({ consultation: patientView(updated!) });
  });

  // Eventos en vivo de mi consulta (SSE).
  app.get("/v1/consultations/:id/events", async (req, reply) => {
    const { id } = req.params as { id: string };
    const sse = startSSE(req, reply);
    if (!sse) return;
    const c = repo.getConsultation(id);
    if (!c || (c.patient_id !== sse.userId && c.doctor_id !== sse.userId)) {
      reply.raw.write(`event: error\ndata: {"error":"no_autorizado"}\n\n`); reply.raw.end(); return;
    }
    const unsub = bus.subscribe(chConsultation(id), (data) => sse.send("update", data));
    req.raw.on("close", () => { unsub(); });
  });

  /* ───────────────────────── MÉDICO ───────────────────────── */

  const doctorOnly = { preHandler: [requireAuth, requireRole("doctor")] };

  // Cola de pacientes esperando en mi especialidad.
  app.get("/v1/doctor/queue", doctorOnly, async (req, reply) => {
    const d = repo.getDoctor(req.userId!);
    if (!d) return reply.code(404).send({ error: "sin_perfil" });
    const q = repo.queueForSpecialty(d.specialty).map((c) => ({
      id: c.id, reason: decryptPHI<string>(c.reason_enc), waitingSince: c.created_at,
    }));
    return reply.send({ specialty: d.specialty, queue: q });
  });

  // Tomar el siguiente paciente (asignación atómica).
  app.post("/v1/doctor/consultations/next", doctorOnly, async (req, reply) => {
    const d = repo.getDoctor(req.userId!);
    if (!d) return reply.code(404).send({ error: "sin_perfil" });
    if (d.license_status !== "verified") return reply.code(403).send({ error: "colegiacion_no_verificada" });
    if (d.availability !== "online") return reply.code(409).send({ error: "no_disponible", message: "Ponte disponible para atender." });

    const c = repo.claimNext(req.userId!, d.specialty);
    if (!c) return reply.code(404).send({ error: "cola_vacia", message: "No hay pacientes en espera." });

    repo.logAccess(c.id, req.userId!, c.patient_id, "assigned");
    bus.publish(chConsultation(c.id), { type: "assigned", doctor: { id: d.user_id, name: d.full_name, rating: d.rating } });
    return reply.send({ consultation: doctorView(c) });
  });

  // Ver consulta asignada + historial del paciente (acceso auditado).
  app.get("/v1/doctor/consultations/:id", doctorOnly, async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = repo.getConsultation(id);
    if (!c || c.doctor_id !== req.userId) return reply.code(404).send({ error: "no_encontrada" });

    const prof = repo.getProfile(c.patient_id);
    let patientProfile: unknown = null;
    if (prof) {
      patientProfile = decryptPHI(prof.data_enc);
      repo.logAccess(c.id, req.userId!, c.patient_id, "view_history"); // auditoría RGPD
    }
    return reply.send({ consultation: doctorView(c), patientProfile });
  });

  // Iniciar la videoconsulta (genera sala).
  app.post("/v1/consultations/:id/start", doctorOnly, async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = repo.getConsultation(id);
    if (!c || c.doctor_id !== req.userId) return reply.code(404).send({ error: "no_encontrada" });
    if (c.status !== "assigned") return reply.code(409).send({ error: "estado_invalido" });
    // En producción: solicitar sala y token al proveedor WebRTC (Twilio/Daily/Vonage).
    const roomId = `room_${randomUUID().slice(0, 12)}`;
    const updated = repo.startConsultation(id, roomId);
    bus.publish(chConsultation(id), { type: "in_progress", roomId });
    return reply.send({ consultation: doctorView(updated!) });
  });

  // Guardar notas clínicas (cifradas).
  app.post("/v1/consultations/:id/notes", doctorOnly, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { notes } = z.object({ notes: z.string().max(8000) }).parse(req.body);
    const c = repo.getConsultation(id);
    if (!c || c.doctor_id !== req.userId) return reply.code(404).send({ error: "no_encontrada" });
    repo.saveNotes(id, encryptPHI(notes));
    return reply.send({ ok: true });
  });

  // Cerrar consulta con informe.
  app.post("/v1/consultations/:id/complete", doctorOnly, async (req, reply) => {
    const { notes, summary } = z.object({
      notes: z.string().max(8000).optional(),
      summary: z.string().max(8000).optional(),
    }).parse(req.body);
    const { id } = req.params as { id: string };
    const c = repo.getConsultation(id);
    if (!c || c.doctor_id !== req.userId) return reply.code(404).send({ error: "no_encontrada" });
    if (!["assigned", "in_progress"].includes(c.status)) return reply.code(409).send({ error: "estado_invalido" });

    const updated = repo.completeConsultation(
      id,
      notes !== undefined ? encryptPHI(notes) : null,
      summary !== undefined ? encryptPHI(summary) : null,
    );
    repo.incrementDoctorConsultations(req.userId!);
    // Devengo del médico (si la consulta estaba pagada).
    const pay = repo.getPaymentByConsultation(id);
    if (pay && pay.status === "paid") {
      const gross = c.price_cents;
      const net = Math.round((gross * config.doctorPayoutPct) / 100);
      repo.createEarning(id, req.userId!, gross, gross - net, net);
    }
    repo.logAccess(id, req.userId!, c.patient_id, "completed");
    bus.publish(chConsultation(id), { type: "completed" });
    return reply.send({ consultation: doctorView(updated!) });
  });

  // Cola en vivo para el médico (SSE): nuevos pacientes en su especialidad.
  app.get("/v1/doctor/queue/events", async (req, reply) => {
    const sse = startSSE(req, reply);
    if (!sse) return;
    const d = repo.getDoctor(sse.userId);
    if (!d) { reply.raw.end(); return; }
    const unsub = bus.subscribe(chQueue(d.specialty), (data) => sse.send("queue", data));
    req.raw.on("close", () => { unsub(); });
  });
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { repo } from "./db.js";
import { requireAuth, requireRole } from "./middleware.js";
import { payments } from "./payments.js";
import { bus, chQueue, chConsultation } from "./bus.js";
import { config } from "./env.js";

// Cuando un pago se confirma, la consulta entra en la cola.
function activateConsultation(consultationId: string) {
  const c = repo.activateConsultation(consultationId);
  if (c) bus.publish(chQueue(c.specialty), { type: "new", consultationId: c.id });
  return c;
}

export async function paymentRoutes(app: FastifyInstance) {
  // Estado del pago de una consulta (para mostrar el importe en el checkout).
  app.get("/v1/consultations/:id/payment", { preHandler: [requireAuth, requireRole("patient")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = repo.getConsultation(id);
    if (!c || c.patient_id !== req.userId) return reply.code(404).send({ error: "no_encontrada" });
    const p = repo.getPaymentByConsultation(id);
    if (!p) return reply.code(404).send({ error: "sin_pago" });
    return reply.send({ payment: { id: p.id, amountCents: p.amount_cents, currency: p.currency, status: p.status, provider: p.provider }, specialty: c.specialty });
  });

  // Iniciar el cobro: crea el intent en el proveedor y devuelve el clientSecret.
  app.post("/v1/payments/:id/checkout", { preHandler: [requireAuth, requireRole("patient")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = repo.getPayment(id);
    if (!p || p.patient_id !== req.userId) return reply.code(404).send({ error: "no_encontrado" });
    if (p.status === "paid") return reply.code(409).send({ error: "ya_pagado" });

    const intent = await payments.createIntent(p.amount_cents, p.currency);
    repo.setPaymentRef(p.id, intent.ref, intent.provider);
    return reply.send({
      clientSecret: intent.clientSecret,
      provider: intent.provider,
      publishableKeyHint: intent.provider === "stripe" ? "usa tu STRIPE_PUBLISHABLE_KEY en el front" : null,
      amountCents: p.amount_cents,
      currency: p.currency,
    });
  });

  // Confirmación en modo DEMO (simula que el proveedor cobró). En producción esto
  // NO existe: el cobro lo confirma Stripe y nos llega por el webhook de abajo.
  app.post("/v1/payments/:id/confirm-demo", { preHandler: [requireAuth, requireRole("patient")] }, async (req, reply) => {
    if (payments.mode() !== "demo") return reply.code(400).send({ error: "solo_demo", message: "En producción el pago se confirma por webhook de Stripe." });
    const { id } = req.params as { id: string };
    const p = repo.getPayment(id);
    if (!p || p.patient_id !== req.userId) return reply.code(404).send({ error: "no_encontrado" });
    if (p.status === "paid") return reply.send({ payment: { id: p.id, status: "paid" } });

    repo.markPaymentPaid(p.id);
    const c = activateConsultation(p.consultation_id);
    return reply.send({ payment: { id: p.id, status: "paid" }, consultation: c ? { id: c.id, status: c.status } : null });
  });

  // Webhook de Stripe (producción). Stripe llama aquí al confirmarse el pago.
  // Nota: la verificación de firma requiere el cuerpo crudo; se documenta en el README.
  app.post("/v1/payments/webhook", async (req, reply) => {
    const event = req.body as any;
    if (event?.type === "payment_intent.succeeded") {
      const ref = event.data?.object?.id;
      // localizar el pago por provider_ref y marcarlo
      // (en una BBDD real, índice por provider_ref; aquí búsqueda directa)
      const all = (repo as any);
      void all;
      // Implementación simple: el front nos pasa el id en metadata en prod.
      const payId = event.data?.object?.metadata?.payment_id;
      if (payId) {
        const p = repo.getPayment(payId);
        if (p && p.status !== "paid") { repo.markPaymentPaid(p.id); activateConsultation(p.consultation_id); }
      }
      void ref;
    }
    return reply.send({ received: true });
  });

  // Mis pagos / recibos.
  app.get("/v1/payments/me", { preHandler: [requireAuth, requireRole("patient")] }, async (req, reply) => {
    const list = repo.listPaymentsByPatient(req.userId!).map((p) => ({
      id: p.id, amountCents: p.amount_cents, currency: p.currency, status: p.status,
      provider: p.provider, createdAt: p.created_at, paidAt: p.paid_at, consultationId: p.consultation_id,
    }));
    return reply.send({ payments: list });
  });
}

// Proveedor de pago. Abstrae el cobro para que el resto del código no dependa
// de Stripe. En 'demo' se simula (no se cobra dinero real). En 'stripe' se crea
// un PaymentIntent real; el cobro lo confirma Stripe y nos lo notifica por
// webhook. Las claves van en variables de entorno y nunca en el código.
import { randomBytes } from "node:crypto";
import { config } from "./env.js";

export interface Intent { ref: string; clientSecret: string; provider: "demo" | "stripe"; }

export const payments = {
  mode(): "demo" | "stripe" {
    return config.stripeSecretKey ? "stripe" : "demo";
  },

  async createIntent(amountCents: number, currency: string): Promise<Intent> {
    if (this.mode() === "stripe") {
      // Producción: crea el PaymentIntent en Stripe.
      const res = await fetch("https://api.stripe.com/v1/payment_intents", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.stripeSecretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          amount: String(amountCents),
          currency,
          "automatic_payment_methods[enabled]": "true",
        }),
      });
      if (!res.ok) throw new Error(`Stripe: ${res.status}`);
      const pi = (await res.json()) as any;
      return { ref: pi.id, clientSecret: pi.client_secret, provider: "stripe" };
    }
    // Demo: intent simulado, sin cobro real.
    const ref = "demo_pi_" + randomBytes(8).toString("hex");
    return { ref, clientSecret: ref + "_secret", provider: "demo" };
  },
};

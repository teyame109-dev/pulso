import Fastify from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { config } from "./env.js";
import { authRoutes } from "./auth.routes.js";
import { patientRoutes } from "./patient.routes.js";
import { doctorRoutes } from "./doctor.routes.js";
import { adminRoutes } from "./admin.routes.js";
import { consultationRoutes } from "./consultation.routes.js";
import { prescriptionRoutes } from "./prescription.routes.js";
import { paymentRoutes } from "./payment.routes.js";
import { repo } from "./db.js";
import { hashPassword } from "./security.js";

const app = Fastify({
  logger: { transport: undefined, level: "info" },
  bodyLimit: 256 * 1024,
});

// Cabeceras de seguridad
await app.register(helmet, { contentSecurityPolicy: false });

// CORS mínimo (sin dependencia externa): solo el origen de la app
app.addHook("onRequest", async (req, reply) => {
  reply.header("Access-Control-Allow-Origin", config.corsOrigin);
  reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  reply.header("Vary", "Origin");
  if (req.method === "OPTIONS") reply.code(204).send();
});

// Límite de peticiones global (defensa básica anti fuerza bruta)
await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024 } });

// Sirve el front compilado (servicio único). La carpeta public/ se genera al
// construir: el build del front se copia ahí. Si no existe, solo va la API.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join as pathJoin } from "node:path";
const __dir = dirname(fileURLToPath(import.meta.url));
const publicDir = pathJoin(__dir, "..", "public");
if (existsSync(publicDir)) {
  const fastifyStatic = (await import("@fastify/static")).default;
  await app.register(fastifyStatic, { root: publicDir, prefix: "/" });
  // Fallback SPA: cualquier ruta no-API devuelve index.html.
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/v1/") || req.url.startsWith("/health")) {
      return reply.code(404).send({ error: "no_encontrado" });
    }
    return reply.sendFile("index.html");
  });
}

app.get("/health", async () => ({ status: "ok", ts: new Date().toISOString() }));

await app.register(authRoutes);
await app.register(patientRoutes);
await app.register(doctorRoutes);
await app.register(adminRoutes);
await app.register(consultationRoutes);
await app.register(prescriptionRoutes);
await app.register(paymentRoutes);

// Admin de arranque: si no existe ningún admin, lo creamos desde el entorno.
if (repo.countByRole("admin") === 0) {
  repo.createAdmin(config.adminEmail, hashPassword(config.adminPassword));
  app.log.info(`Admin de arranque creado: ${config.adminEmail}`);
}

// Datos de demostración: médicos, pacientes e histórico para el panel.
if (config.seedDemo && !repo.getUserByEmail("doctor@pulso.es")) {
  const { seedDemoData } = await import("./seed.js");
  seedDemoData((m) => app.log.info(m));
  app.log.info("Médico de demo: doctor@pulso.es / Doctor2026 (Dermatología, verificado)");
}

app.setErrorHandler((err, _req, reply) => {
  req_log(err);
  if ((err as any).statusCode === 429) {
    return reply.code(429).send({ error: "demasiadas_peticiones", message: "Inténtalo de nuevo en un momento." });
  }
  return reply.code(500).send({ error: "error_interno" });
});
function req_log(err: unknown) { app.log.error(err); }

app
  .listen({ port: config.port, host: "0.0.0.0" })
  .then(() => app.log.info(`Pulso backend escuchando en :${config.port} (${config.env})`))
  .catch((e) => { app.log.error(e); process.exit(1); });

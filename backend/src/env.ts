// Carga y valida la configuración desde variables de entorno.
import { readFileSync } from "node:fs";

// Carga mínima de .env sin dependencias externas.
function loadDotenv() {
  try {
    const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch {
    /* sin .env: usamos valores por defecto de desarrollo */
  }
}
loadDotenv();

const need = (k: string, fallback?: string) => {
  const v = process.env[k] ?? fallback;
  if (v === undefined) throw new Error(`Falta la variable de entorno ${k}`);
  return v;
};

export const config = {
  env: need("NODE_ENV", "development"),
  port: Number(need("PORT", "3001")),
  corsOrigin: need("CORS_ORIGIN", "http://localhost:5173"),
  jwtAccessSecret: need("JWT_ACCESS_SECRET", "dev_access_secret_change_me_please_0123456789abcdef"),
  jwtRefreshSecret: need("JWT_REFRESH_SECRET", "dev_refresh_secret_change_me_please_fedcba9876543210"),
  phiKeyHex: need("PHI_ENC_KEY", "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"),
  accessTtl: need("ACCESS_TTL", "15m"),
  refreshTtlDays: Number(need("REFRESH_TTL_DAYS", "30")),
  dbFile: need("DB_FILE", "./pulso.db"),

  // App / web del paciente (destino de los enlaces de los emails)
  appUrl: need("APP_URL", "http://localhost:5173"),
  // URL pública de esta API (para el enlace de verificación de un clic)
  apiUrl: need("API_URL", "http://localhost:3001"),

  // Email
  mailTransport: need("MAIL_TRANSPORT", "console"), // "console" (demo) | "smtp"
  mailFrom: need("MAIL_FROM", "Pulso <no-reply@pulso.es>"),
  smtpHost: process.env.SMTP_HOST,
  smtpPort: Number(process.env.SMTP_PORT ?? "587"),
  smtpUser: process.env.SMTP_USER,
  smtpPass: process.env.SMTP_PASS,
  verifyTtlHours: Number(need("VERIFY_TTL_HOURS", "24")),

  // Admin de arranque (se crea al iniciar si no existe ninguno)
  adminEmail: need("ADMIN_EMAIL", "admin@pulso.es"),
  adminPassword: need("ADMIN_PASSWORD", "CambiaEstoYa_2026"),

  // Roles a los que se exige 2FA (CSV)
  require2faRoles: need("REQUIRE_2FA_ROLES", "doctor,admin").split(",").map((s) => s.trim()).filter(Boolean),

  // Sembrar datos de demostración (médico verificado) al arrancar
  seedDemo: need("SEED_DEMO", "false") === "true",

  // Pagos. Si hay clave de Stripe, se cobra de verdad; si no, modo demo.
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
  currency: need("PAYMENTS_CURRENCY", "eur"),

  // Porcentaje del importe de la consulta que se devenga al médico (resto = comisión plataforma).
  doctorPayoutPct: parseInt(need("DOCTOR_PAYOUT_PCT", "70"), 10),

  // Carpeta de documentos subidos (en producción: bucket S3 en la UE, cifrado).
  uploadDir: need("UPLOAD_DIR", "./uploads"),
};

export const isProd = config.env === "production";

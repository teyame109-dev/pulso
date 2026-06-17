# Pulso · Backend de autenticación y perfil clínico

API de autenticación y gestión del perfil clínico del paciente para Pulso
(telemedicina). Primer módulo del backend: registro, verificación, login con
JWT + refresh rotatorio, y cuestionario médico cifrado en reposo con
consentimiento granular y derechos RGPD.

## Arrancar en local

Requisitos: Node.js 22+ (usa el módulo `node:sqlite` integrado).

```bash
cp .env.example .env      # ajusta secretos
npm install
npm run dev               # API en http://localhost:3001
```

No necesita servidor de base de datos: la demo usa SQLite embebido en un
archivo (`pulso.db`). En producción se sustituye por PostgreSQL (ver abajo).

## Endpoints

### Autenticación
| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| POST | `/v1/auth/register` | Crea cuenta de paciente y envía email de verificación | — |
| GET | `/v1/auth/verify-email?token=` | Verifica con un clic y redirige a la app | — |
| POST | `/v1/auth/verify-email` | Verifica con token (para SPA) | — |
| POST | `/v1/auth/resend-verification` | Reenvía el email de verificación | — |
| POST | `/v1/auth/accept-invite` | Médico fija su contraseña desde la invitación | — |
| POST | `/v1/auth/login` | Devuelve tokens, o un desafío si hay 2FA | — |
| POST | `/v1/auth/2fa/setup` | Genera secreto TOTP y QR | autenticado |
| POST | `/v1/auth/2fa/enable` | Activa 2FA y entrega códigos de respaldo | autenticado |
| POST | `/v1/auth/2fa/verify` | Segundo factor en el login (TOTP o respaldo) | desafío |
| POST | `/v1/auth/2fa/disable` | Desactiva 2FA | autenticado |
| POST | `/v1/auth/refresh` | Rota tokens; detecta reuso y revoca la familia | — |
| POST | `/v1/auth/logout` | Revoca el refresh token | — |
| GET | `/v1/auth/me` | Datos del usuario (incluye rol) | Bearer |

### Doble factor (2FA)

TOTP estándar (compatible con Google Authenticator, Authy, 1Password…). Flujo:
`setup` genera el secreto y un QR; `enable` lo confirma con un código y entrega
8 **códigos de respaldo** de un solo uso. A partir de ahí, el `login` con 2FA
activo no entrega tokens: devuelve `twofaRequired` y un `challengeToken`, y los
tokens se obtienen en `verify` con el código TOTP o uno de respaldo. El secreto
se guarda **cifrado** en reposo. Es opcional para pacientes y **exigible a los
roles de `REQUIRE_2FA_ROLES`** (médico y admin por defecto): a esos roles el
login responde con `mustSetup2fa` hasta que lo configuran.

### Paciente
| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| PUT | `/v1/patients/me/profile` | Guarda el cuestionario (requiere email verificado) | paciente |
| GET | `/v1/patients/me/profile` | Devuelve el perfil descifrado del titular | paciente |
| GET | `/v1/patients/me/history` | Historial: perfil + consultas (con informe) + recetas | paciente |
| DELETE | `/v1/patients/me` | Supresión RGPD: borra cuenta y datos | paciente |

### Médico
| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| GET | `/v1/doctors/me` | Ficha del propio médico | médico |
| PUT | `/v1/doctors/me/profile` | Edita bio e idiomas | médico |
| PUT | `/v1/doctors/me/availability` | Online/pausa/offline (exige colegiación verificada) | médico |
| GET | `/v1/doctors?specialty=&available=` | Médicos verificados para el matching | autenticado |

### Médicos
| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| GET | `/v1/doctors/me` | Ficha propia (incluye estado de alta) | médico |
| POST | `/v1/doctors/me/onboarding` | Alta: titulación, seguro y banco (IBAN cifrado) | médico |
| POST | `/v1/doctors/me/documents` | Sube titulación o póliza (multipart) | médico |
| PUT | `/v1/doctors/me/availability` | Disponibilidad (si está verificado) | médico |
| GET | `/v1/doctor/earnings?from=&to=` | Liquidaciones por fechas | médico |

### Administración
| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| POST | `/v1/admin/doctors` | Alta de médico por invitación | admin |
| GET | `/v1/admin/doctors` | Lista de médicos con estados (panel) | admin |
| PUT | `/v1/admin/doctors/:id/license` | Verifica/rechaza la colegiación | admin |
| GET | `/v1/admin/metrics?period=today\|7d\|30d` | Métricas para el panel | admin |

### Consultas
| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| POST | `/v1/consultations` | Paciente crea solicitud (entra en cola) | paciente |
| GET | `/v1/consultations/me` | Mis consultas | paciente |
| GET | `/v1/consultations/:id` | Estado (dueño o médico asignado) | autenticado |
| POST | `/v1/consultations/:id/cancel` | Cancelar (si en espera/asignada) | paciente |
| GET | `/v1/consultations/:id/events` | Eventos en vivo (SSE) | dueño/médico |
| GET | `/v1/doctor/queue` | Cola de la especialidad del médico | médico |
| POST | `/v1/doctor/consultations/next` | Tomar el siguiente (atómico) | médico |
| GET | `/v1/doctor/consultations/:id` | Consulta + historial (auditado) | médico |
| POST | `/v1/consultations/:id/start` | Iniciar videoconsulta (genera sala) | médico |
| POST | `/v1/consultations/:id/notes` | Guardar notas (cifradas) | médico |
| POST | `/v1/consultations/:id/complete` | Cerrar con informe | médico |
| GET | `/v1/doctor/queue/events` | Nuevos pacientes en cola (SSE) | médico |

### Receta electrónica
| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| POST | `/v1/consultations/:id/prescription` | El médico emite la receta | médico |
| GET | `/v1/consultations/:id/prescription` | Receta de la consulta | dueño/médico |
| GET | `/v1/prescriptions/me` | Mis recetas | paciente |
| GET | `/v1/prescriptions/:id` | Documento de una receta | dueño/emisor |

### Pagos
| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| GET | `/v1/consultations/:id/payment` | Importe y estado del pago | paciente |
| POST | `/v1/payments/:id/checkout` | Inicia el cobro (intent) | paciente |
| POST | `/v1/payments/:id/confirm-demo` | Confirma el pago (solo demo) | paciente |
| POST | `/v1/payments/webhook` | Webhook de Stripe (producción) | — |
| GET | `/v1/payments/me` | Mis recibos | paciente |

`GET /health` está abierto.

## Pagos

La consulta se crea en estado `pending_payment` y **no entra en la cola hasta
que se paga**. El precio depende de la especialidad. Sin clave de Stripe, el
sistema funciona en **modo demo**: el cobro se simula con `confirm-demo` (no se
mueve dinero). Con `STRIPE_SECRET_KEY`, el cobro pasa a ser real: el backend
crea un PaymentIntent en Stripe, la tarjeta se cobra en el cliente con Stripe.js
y Stripe confirma el pago llamando al **webhook**, momento en que la consulta se
activa. Las claves van en variables de entorno, nunca en el código.

## Matching y tiempo real

El paciente entra en cola por especialidad. El médico disponible toma el
siguiente con `next`, que adjudica de forma **atómica** el más antiguo (en
PostgreSQL: `SELECT … FOR UPDATE SKIP LOCKED`). El estado se propaga en vivo
por **SSE** sobre un bus de eventos en memoria; en producción ese bus se
sustituye por **Redis pub/sub + WebSocket** para escalar a varias instancias
(misma interfaz en `src/bus.ts`). El motivo de consulta y las notas clínicas se
**cifran**, y cada acceso del médico al historial del paciente queda en el
**registro de auditoría** (`access_log`).

## Receta electrónica

El médico emite una receta asociada a la consulta con uno o más medicamentos
(medicamento, posología, duración). Los medicamentos se **cifran** y la receta
se **sella** con un hash de integridad sobre su contenido; el paciente la
consulta y la descarga como documento. En producción, el sello se sustituye por
la **firma electrónica cualificada** del facultativo, y la **dispensación en
farmacia** requiere tramitarla por una plataforma de receta electrónica privada
**homologada** (por ejemplo REMPe, del Consejo General de Colegios de
Farmacéuticos).

## Roles y altas

- **Paciente**: se registra solo (`/v1/auth/register`) y verifica su email.
- **Médico**: lo da de alta el administrador (`/v1/admin/doctors`), que envía
  una invitación. El médico fija su contraseña (`/v1/auth/accept-invite`) y
  queda verificado. No puede ponerse disponible hasta que el admin verifica su
  colegiación.
- **Admin**: se crea uno al arrancar si no existe ninguno, a partir de
  `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Gestiona médicos y colegiaciones.

El rol viaja en el access token y se revalida contra la base de datos en las
acciones sensibles.

## Email de verificación

El registro envía un correo con un enlace de verificación de un clic. El
enlace caduca (`VERIFY_TTL_HOURS`, 24 h por defecto), se puede reenviar, y al
pulsarlo verifica y redirige a `APP_URL/verificado?status=ok|expired|invalid`.
Hasta verificar, el paciente puede iniciar sesión pero no guardar su historial.

Transporte configurable con `MAIL_TRANSPORT`:

- `console` (demo): no envía nada; renderiza el email en `./outbox/*.html` para
  previsualizar y registra el enlace en el log.
- `smtp` (producción): envío real con nodemailer. Rellena `SMTP_HOST`,
  `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` de un proveedor transaccional con
  residencia en la UE (Brevo, Mailjet, Scaleway, Amazon SES eu-west…).

## Seguridad

- Contraseñas: `scrypt` (KDF de la librería estándar, sin dependencias
  nativas). En producción puede migrarse a argon2id.
- Datos de salud (PHI): cifrado **AES-256-GCM** a nivel de aplicación antes de
  persistir. En la base de datos solo queda texto cifrado.
- Tokens: access JWT de 15 min; refresh de 30 días con **rotación** y guardado
  como hash. El reuso de un refresh ya consumido revoca toda la familia.
- `@fastify/helmet`, rate limiting global y por endpoint sensible, validación
  estricta con `zod`, mensajes de error que no revelan si un email existe.

## Migrar a PostgreSQL

Toda la persistencia está aislada en `src/db.ts` tras el objeto `repo`. Para
producción:

1. Define `DATABASE_URL` en `.env` (PostgreSQL gestionado en la UE, TLS).
2. Reescribe `src/db.ts` con el driver `pg` (o Prisma), manteniendo la misma
   interfaz de `repo`. No hay que tocar rutas ni servicios.

## Estructura

```
src/
  env.ts            Configuración tipada desde entorno
  db.ts             Capa de datos aislada (SQLite → PostgreSQL)
  security.ts       Hash de contraseñas, cifrado PHI y JWT
  middleware.ts     requireAuth + requireVerified (Bearer)
  security.ts       Hash de contraseñas, cifrado PHI, JWT y 2FA (TOTP)
  middleware.ts     requireAuth + requireVerified + requireRole
  emails.ts         Plantillas HTML/texto (verificación e invitación)
  mailer.ts         Envío de correo (consola/outbox en demo, SMTP en prod)
  auth.routes.ts    Registro, verificación, invitación, login, 2FA, refresh, me
  patient.routes.ts Perfil clínico cifrado y supresión RGPD
  doctor.routes.ts  Perfil, disponibilidad y listado de médicos
  admin.routes.ts   Alta de médicos por invitación y colegiación
  consultation.routes.ts  Cola, matching, ciclo de la consulta y SSE
  bus.ts            Bus de eventos (memoria en demo, Redis pub/sub en prod)
  server.ts         Fastify + plugins + seed de admin + arranque
```

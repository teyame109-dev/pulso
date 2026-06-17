// ── Capa de datos ─────────────────────────────────────────────────────
// SQLite embebido (node:sqlite) para ejecutar y probar sin servidor. Toda la
// lógica de negocio usa `repo`; migrar a PostgreSQL solo afecta a este archivo.
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { config } from "./env.js";

const db = new DatabaseSync(config.dbFile);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'patient',   -- patient | doctor | admin
  email_verified  INTEGER NOT NULL DEFAULT 0,
  verify_token    TEXT,
  verify_expires  TEXT,
  invite_token    TEXT,
  invite_expires  TEXT,
  twofa_secret_enc TEXT,
  twofa_enabled   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS twofa_backup_codes (
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  revoked     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patient_profiles (
  user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data_enc       TEXT NOT NULL,
  consent_assist INTEGER NOT NULL DEFAULT 0,
  consent_terms  INTEGER NOT NULL DEFAULT 0,
  consent_reco   INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS doctor_profiles (
  user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name      TEXT NOT NULL,
  specialty      TEXT NOT NULL,
  license_number TEXT NOT NULL,
  license_status TEXT NOT NULL DEFAULT 'pending',   -- pending | verified | rejected
  availability   TEXT NOT NULL DEFAULT 'offline',   -- online | pausa | offline
  bio            TEXT NOT NULL DEFAULT '',
  languages      TEXT NOT NULL DEFAULT '[]',        -- JSON array
  rating         REAL NOT NULL DEFAULT 0,
  consultations  INTEGER NOT NULL DEFAULT 0,
  degree_title   TEXT NOT NULL DEFAULT '',          -- titulación
  insurer        TEXT NOT NULL DEFAULT '',          -- seguro RC: aseguradora
  policy_number  TEXT NOT NULL DEFAULT '',          -- nº de póliza
  policy_expiry  TEXT NOT NULL DEFAULT '',          -- vigencia
  bank_iban_enc  TEXT,                              -- IBAN cifrado
  bank_holder_enc TEXT,                             -- titular cifrado
  onboarding_complete INTEGER NOT NULL DEFAULT 0,
  last_seen      TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS doctor_documents (
  id          TEXT PRIMARY KEY,
  doctor_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,                        -- titulacion | seguro
  stored_name TEXT NOT NULL,
  original    TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS earnings (
  id              TEXT PRIMARY KEY,
  consultation_id TEXT NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
  doctor_id       TEXT NOT NULL,
  gross_cents     INTEGER NOT NULL,
  fee_cents       INTEGER NOT NULL,
  net_cents       INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | settled
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consultations (
  id            TEXT PRIMARY KEY,
  patient_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  specialty     TEXT NOT NULL,
  reason_enc    TEXT NOT NULL,                       -- motivo (dato de salud) cifrado
  status        TEXT NOT NULL DEFAULT 'waiting',     -- waiting|assigned|in_progress|completed|cancelled
  room_id       TEXT,
  notes_enc     TEXT,                                -- notas clínicas cifradas
  summary_enc   TEXT,                                -- informe cifrado
  price_cents   INTEGER NOT NULL DEFAULT 2900,
  created_at    TEXT NOT NULL,
  assigned_at   TEXT,
  started_at    TEXT,
  completed_at  TEXT,
  cancelled_at  TEXT
);

CREATE TABLE IF NOT EXISTS access_log (
  id              TEXT PRIMARY KEY,
  consultation_id TEXT,
  actor_id        TEXT NOT NULL,
  subject_id      TEXT NOT NULL,
  action          TEXT NOT NULL,
  at              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prescriptions (
  id              TEXT PRIMARY KEY,
  consultation_id TEXT NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
  patient_id      TEXT NOT NULL,
  doctor_id       TEXT NOT NULL,
  code            TEXT NOT NULL UNIQUE,        -- folio (en prod: el de la plataforma homologada)
  items_enc       TEXT NOT NULL,              -- medicamentos cifrados (datos de salud)
  signature       TEXT NOT NULL,              -- sello de integridad (demo) / firma cualificada (prod)
  status          TEXT NOT NULL DEFAULT 'issued', -- issued | dispensed | cancelled
  issued_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id              TEXT PRIMARY KEY,
  consultation_id TEXT NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
  patient_id      TEXT NOT NULL,
  amount_cents    INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'eur',
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | paid | failed | refunded
  provider        TEXT NOT NULL DEFAULT 'demo',     -- demo | stripe
  provider_ref    TEXT,                             -- id del PaymentIntent (Stripe)
  created_at      TEXT NOT NULL,
  paid_at         TEXT
);
`);

export type Role = "patient" | "doctor" | "admin";
export interface UserRow {
  id: string; email: string; password_hash: string; role: Role;
  email_verified: number; verify_token: string | null; verify_expires: string | null;
  invite_token: string | null; invite_expires: string | null;
  twofa_secret_enc: string | null; twofa_enabled: number; created_at: string;
}
export interface ProfileRow {
  user_id: string; data_enc: string;
  consent_assist: number; consent_terms: number; consent_reco: number;
  created_at: string; updated_at: string;
}
export interface DoctorRow {
  user_id: string; full_name: string; specialty: string; license_number: string;
  license_status: "pending" | "verified" | "rejected";
  availability: "online" | "pausa" | "offline";
  bio: string; languages: string; rating: number; consultations: number;
  degree_title: string; insurer: string; policy_number: string; policy_expiry: string;
  bank_iban_enc: string | null; bank_holder_enc: string | null; onboarding_complete: number;
  last_seen: string | null; created_at: string; updated_at: string;
}
export interface DoctorDocumentRow {
  id: string; doctor_id: string; type: string; stored_name: string;
  original: string; mime: string; size: number; uploaded_at: string;
}
export interface EarningRow {
  id: string; consultation_id: string; doctor_id: string;
  gross_cents: number; fee_cents: number; net_cents: number;
  status: "pending" | "settled"; created_at: string;
}
export interface ConsultationRow {
  id: string; patient_id: string; doctor_id: string | null; specialty: string;
  reason_enc: string; status: "pending_payment" | "waiting" | "assigned" | "in_progress" | "completed" | "cancelled";
  room_id: string | null; notes_enc: string | null; summary_enc: string | null; price_cents: number;
  created_at: string; assigned_at: string | null; started_at: string | null;
  completed_at: string | null; cancelled_at: string | null;
}
export interface PaymentRow {
  id: string; consultation_id: string; patient_id: string; amount_cents: number;
  currency: string; status: "pending" | "paid" | "failed" | "refunded";
  provider: string; provider_ref: string | null; created_at: string; paid_at: string | null;
}
export interface PrescriptionRow {
  id: string; consultation_id: string; patient_id: string; doctor_id: string;
  code: string; items_enc: string; signature: string;
  status: "issued" | "dispensed" | "cancelled"; issued_at: string;
}

const now = () => new Date().toISOString();

export const repo = {
  // ── users ──
  createUser(email: string, passwordHash: string, verifyToken: string, verifyExpires: string): UserRow {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO users (id, email, password_hash, role, email_verified, verify_token, verify_expires, created_at)
       VALUES (?, ?, ?, 'patient', 0, ?, ?, ?)`
    ).run(id, email, passwordHash, verifyToken, verifyExpires, now());
    return this.getUserById(id)!;
  },
  createAdmin(email: string, passwordHash: string): UserRow {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO users (id, email, password_hash, role, email_verified, created_at)
       VALUES (?, ?, ?, 'admin', 1, ?)`
    ).run(id, email, passwordHash, now());
    return this.getUserById(id)!;
  },
  // Médico de demostración ya verificado (para SEED_DEMO).
  seedDoctor(email: string, passwordHash: string, fullName: string, specialty: string, license: string): UserRow {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO users (id, email, password_hash, role, email_verified, created_at)
       VALUES (?, ?, ?, 'doctor', 1, ?)`
    ).run(id, email, passwordHash, now());
    db.prepare(
      `INSERT INTO doctor_profiles (user_id, full_name, specialty, license_number, license_status, bio, languages, rating, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'verified', 'Profesional colegiado.', '["Español","Inglés"]', 4.9, ?, ?)`
    ).run(id, fullName, specialty, license, now(), now());
    return this.getUserById(id)!;
  },
  // Paciente de demostración ya verificado (para SEED_DEMO).
  seedPatient(email: string, passwordHash: string): UserRow {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO users (id, email, password_hash, role, email_verified, created_at)
       VALUES (?, ?, ?, 'patient', 1, ?)`
    ).run(id, email, passwordHash, now());
    return this.getUserById(id)!;
  },
  // Consulta histórica ya completada (para poblar el panel de dirección).
  seedCompletedConsultation(patientId: string, doctorId: string, specialty: string, reasonEnc: string, priceCents: number): ConsultationRow {
    const id = randomUUID(); const t = now();
    db.prepare(
      `INSERT INTO consultations (id, patient_id, doctor_id, specialty, reason_enc, status, price_cents, created_at, assigned_at, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)`
    ).run(id, patientId, doctorId, specialty, reasonEnc, priceCents, t, t, t, t);
    this.incrementDoctorConsultations(doctorId);
    return this.getConsultation(id)!;
  },
  getUserByEmail(email: string): UserRow | undefined {
    return db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as UserRow | undefined;
  },
  getUserById(id: string): UserRow | undefined {
    return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
  },
  countByRole(role: Role): number {
    return (db.prepare(`SELECT COUNT(*) c FROM users WHERE role = ?`).get(role) as any).c as number;
  },
  setVerifyToken(userId: string, token: string, expires: string) {
    db.prepare(`UPDATE users SET verify_token = ?, verify_expires = ? WHERE id = ?`).run(token, expires, userId);
  },
  verifyEmail(token: string): { ok: boolean; reason?: "invalid" | "expired"; user?: UserRow } {
    const u = db.prepare(`SELECT * FROM users WHERE verify_token = ?`).get(token) as UserRow | undefined;
    if (!u) return { ok: false, reason: "invalid" };
    if (u.email_verified) return { ok: true, user: u };
    if (u.verify_expires && new Date(u.verify_expires) < new Date()) return { ok: false, reason: "expired" };
    db.prepare(`UPDATE users SET email_verified = 1, verify_token = NULL, verify_expires = NULL WHERE id = ?`).run(u.id);
    return { ok: true, user: this.getUserById(u.id) };
  },
  deleteUser(id: string) {
    db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
  },

  // ── 2FA ──
  setTwofaSecret(userId: string, secretEnc: string) {
    db.prepare(`UPDATE users SET twofa_secret_enc = ?, twofa_enabled = 0 WHERE id = ?`).run(secretEnc, userId);
  },
  enableTwofa(userId: string) {
    db.prepare(`UPDATE users SET twofa_enabled = 1 WHERE id = ?`).run(userId);
  },
  disableTwofa(userId: string) {
    db.prepare(`UPDATE users SET twofa_secret_enc = NULL, twofa_enabled = 0 WHERE id = ?`).run(userId);
    db.prepare(`DELETE FROM twofa_backup_codes WHERE user_id = ?`).run(userId);
  },
  saveBackupCodes(userId: string, hashes: string[]) {
    db.prepare(`DELETE FROM twofa_backup_codes WHERE user_id = ?`).run(userId);
    const stmt = db.prepare(`INSERT INTO twofa_backup_codes (id, user_id, code_hash, used) VALUES (?, ?, ?, 0)`);
    for (const h of hashes) stmt.run(randomUUID(), userId, h);
  },
  consumeBackupCode(userId: string, codeHash: string): boolean {
    const row = db.prepare(`SELECT id FROM twofa_backup_codes WHERE user_id = ? AND code_hash = ? AND used = 0`)
      .get(userId, codeHash) as { id: string } | undefined;
    if (!row) return false;
    db.prepare(`UPDATE twofa_backup_codes SET used = 1 WHERE id = ?`).run(row.id);
    return true;
  },
  countBackupCodes(userId: string): number {
    return (db.prepare(`SELECT COUNT(*) c FROM twofa_backup_codes WHERE user_id = ? AND used = 0`).get(userId) as any).c;
  },

  // ── invitaciones (médicos) ──
  acceptInvite(token: string, newHash: string): { ok: boolean; reason?: "invalid" | "expired"; user?: UserRow } {
    const u = db.prepare(`SELECT * FROM users WHERE invite_token = ?`).get(token) as UserRow | undefined;
    if (!u) return { ok: false, reason: "invalid" };
    if (u.invite_expires && new Date(u.invite_expires) < new Date()) return { ok: false, reason: "expired" };
    db.prepare(
      `UPDATE users SET password_hash = ?, email_verified = 1, invite_token = NULL, invite_expires = NULL WHERE id = ?`
    ).run(newHash, u.id);
    return { ok: true, user: this.getUserById(u.id) };
  },

  // ── refresh tokens ──
  saveRefresh(id: string, userId: string, tokenHash: string, expiresAt: string): string {
    db.prepare(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`
    ).run(id, userId, tokenHash, expiresAt, now());
    return id;
  },
  findRefresh(id: string) {
    return db.prepare(`SELECT * FROM refresh_tokens WHERE id = ?`).get(id) as
      | { id: string; user_id: string; token_hash: string; expires_at: string; revoked: number } | undefined;
  },
  revokeRefresh(id: string) { db.prepare(`UPDATE refresh_tokens SET revoked = 1 WHERE id = ?`).run(id); },
  revokeAllRefresh(userId: string) { db.prepare(`UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?`).run(userId); },

  // ── patient profile ──
  upsertProfile(userId: string, dataEnc: string, c: { assist: boolean; terms: boolean; reco: boolean }) {
    const existing = this.getProfile(userId);
    if (existing) {
      db.prepare(
        `UPDATE patient_profiles SET data_enc = ?, consent_assist = ?, consent_terms = ?, consent_reco = ?, updated_at = ? WHERE user_id = ?`
      ).run(dataEnc, +c.assist, +c.terms, +c.reco, now(), userId);
    } else {
      db.prepare(
        `INSERT INTO patient_profiles (user_id, data_enc, consent_assist, consent_terms, consent_reco, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(userId, dataEnc, +c.assist, +c.terms, +c.reco, now(), now());
    }
    return this.getProfile(userId)!;
  },
  getProfile(userId: string): ProfileRow | undefined {
    return db.prepare(`SELECT * FROM patient_profiles WHERE user_id = ?`).get(userId) as ProfileRow | undefined;
  },

  // ── doctors ──
  createDoctorAccount(args: {
    email: string; tempHash: string; inviteToken: string; inviteExpires: string;
    fullName: string; specialty: string; licenseNumber: string;
  }): UserRow {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO users (id, email, password_hash, role, email_verified, invite_token, invite_expires, created_at)
       VALUES (?, ?, ?, 'doctor', 0, ?, ?, ?)`
    ).run(id, args.email, args.tempHash, args.inviteToken, args.inviteExpires, now());
    db.prepare(
      `INSERT INTO doctor_profiles (user_id, full_name, specialty, license_number, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, args.fullName, args.specialty, args.licenseNumber, now(), now());
    return this.getUserById(id)!;
  },
  getDoctor(userId: string): DoctorRow | undefined {
    return db.prepare(`SELECT * FROM doctor_profiles WHERE user_id = ?`).get(userId) as DoctorRow | undefined;
  },
  updateDoctorProfile(userId: string, fields: { bio?: string; languages?: string[] }) {
    const d = this.getDoctor(userId); if (!d) return undefined;
    db.prepare(`UPDATE doctor_profiles SET bio = ?, languages = ?, updated_at = ? WHERE user_id = ?`)
      .run(fields.bio ?? d.bio, fields.languages ? JSON.stringify(fields.languages) : d.languages, now(), userId);
    return this.getDoctor(userId);
  },
  setLicenseStatus(userId: string, status: "verified" | "rejected" | "pending") {
    db.prepare(`UPDATE doctor_profiles SET license_status = ?, updated_at = ? WHERE user_id = ?`).run(status, now(), userId);
    if (status !== "verified") db.prepare(`UPDATE doctor_profiles SET availability = 'offline' WHERE user_id = ?`).run(userId);
    return this.getDoctor(userId);
  },
  setAvailability(userId: string, status: "online" | "pausa" | "offline") {
    db.prepare(`UPDATE doctor_profiles SET availability = ?, last_seen = ?, updated_at = ? WHERE user_id = ?`)
      .run(status, now(), now(), userId);
    return this.getDoctor(userId);
  },
  listDoctorsPublic(filter: { specialty?: string; available?: boolean }): DoctorRow[] {
    let sql = `SELECT * FROM doctor_profiles WHERE license_status = 'verified'`;
    const params: any[] = [];
    if (filter.specialty) { sql += ` AND specialty = ?`; params.push(filter.specialty); }
    if (filter.available) sql += ` AND availability = 'online'`;
    sql += ` ORDER BY availability = 'online' DESC, rating DESC`;
    return db.prepare(sql).all(...params) as unknown as DoctorRow[];
  },
  listDoctorsAdmin(): Array<DoctorRow & { email: string }> {
    return db.prepare(
      `SELECT d.*, u.email FROM doctor_profiles d JOIN users u ON u.id = d.user_id ORDER BY d.created_at DESC`
    ).all() as unknown as Array<DoctorRow & { email: string }>;
  },
  incrementDoctorConsultations(userId: string) {
    db.prepare(`UPDATE doctor_profiles SET consultations = consultations + 1, updated_at = ? WHERE user_id = ?`).run(now(), userId);
  },

  // ── alta/onboarding del médico ──
  updateDoctorOnboarding(userId: string, d: {
    degree_title: string; insurer: string; policy_number: string; policy_expiry: string;
    bank_iban_enc: string; bank_holder_enc: string;
  }) {
    db.prepare(
      `UPDATE doctor_profiles SET degree_title = ?, insurer = ?, policy_number = ?, policy_expiry = ?,
        bank_iban_enc = ?, bank_holder_enc = ?, onboarding_complete = 1, updated_at = ? WHERE user_id = ?`
    ).run(d.degree_title, d.insurer, d.policy_number, d.policy_expiry, d.bank_iban_enc, d.bank_holder_enc, now(), userId);
    return this.getDoctor(userId);
  },
  addDoctorDocument(doctorId: string, type: string, storedName: string, original: string, mime: string, size: number): DoctorDocumentRow {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO doctor_documents (id, doctor_id, type, stored_name, original, mime, size, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, doctorId, type, storedName, original, mime, size, now());
    return db.prepare(`SELECT * FROM doctor_documents WHERE id = ?`).get(id) as unknown as DoctorDocumentRow;
  },
  listDoctorDocuments(doctorId: string): DoctorDocumentRow[] {
    return db.prepare(`SELECT * FROM doctor_documents WHERE doctor_id = ? ORDER BY uploaded_at DESC`).all(doctorId) as unknown as DoctorDocumentRow[];
  },

  // ── liquidaciones (earnings) ──
  createEarning(consultationId: string, doctorId: string, gross: number, fee: number, net: number): EarningRow {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO earnings (id, consultation_id, doctor_id, gross_cents, fee_cents, net_cents, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).run(id, consultationId, doctorId, gross, fee, net, now());
    return db.prepare(`SELECT * FROM earnings WHERE id = ?`).get(id) as unknown as EarningRow;
  },
  listEarnings(doctorId: string, fromISO: string, toISO: string): EarningRow[] {
    return db.prepare(
      `SELECT * FROM earnings WHERE doctor_id = ? AND created_at >= ? AND created_at <= ? ORDER BY created_at DESC`
    ).all(doctorId, fromISO, toISO) as unknown as EarningRow[];
  },
  earningsTotals(doctorId: string, fromISO: string, toISO: string) {
    return db.prepare(
      `SELECT COUNT(*) n, COALESCE(SUM(gross_cents),0) gross, COALESCE(SUM(fee_cents),0) fee, COALESCE(SUM(net_cents),0) net
       FROM earnings WHERE doctor_id = ? AND created_at >= ? AND created_at <= ?`
    ).get(doctorId, fromISO, toISO) as { n: number; gross: number; fee: number; net: number };
  },

  // ── consultations ──
  createConsultation(patientId: string, specialty: string, reasonEnc: string, priceCents: number): ConsultationRow {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO consultations (id, patient_id, specialty, reason_enc, status, price_cents, created_at)
       VALUES (?, ?, ?, ?, 'pending_payment', ?, ?)`
    ).run(id, patientId, specialty, reasonEnc, priceCents, now());
    return this.getConsultation(id)!;
  },
  // Activar consulta tras el pago: pasa a la cola.
  activateConsultation(id: string) {
    db.prepare(`UPDATE consultations SET status = 'waiting' WHERE id = ? AND status = 'pending_payment'`).run(id);
    return this.getConsultation(id);
  },
  getConsultation(id: string): ConsultationRow | undefined {
    return db.prepare(`SELECT * FROM consultations WHERE id = ?`).get(id) as ConsultationRow | undefined;
  },
  listConsultationsByPatient(patientId: string): ConsultationRow[] {
    return db.prepare(`SELECT * FROM consultations WHERE patient_id = ? ORDER BY created_at DESC`).all(patientId) as unknown as ConsultationRow[];
  },
  queueForSpecialty(specialty: string): ConsultationRow[] {
    return db.prepare(
      `SELECT * FROM consultations WHERE specialty = ? AND status = 'waiting' ORDER BY created_at ASC`
    ).all(specialty) as unknown as ConsultationRow[];
  },
  queuePosition(id: string): number {
    const c = this.getConsultation(id); if (!c || c.status !== "waiting") return 0;
    const r = db.prepare(
      `SELECT COUNT(*) n FROM consultations WHERE specialty = ? AND status = 'waiting' AND created_at <= ?`
    ).get(c.specialty, c.created_at) as any;
    return r.n as number;
  },
  // Asignación atómica: toma el más antiguo en espera de la especialidad y lo
  // adjudica al médico. En node:sqlite las escrituras son síncronas (atómicas);
  // en PostgreSQL: SELECT ... FOR UPDATE SKIP LOCKED dentro de una transacción.
  claimNext(doctorId: string, specialty: string): ConsultationRow | undefined {
    const next = db.prepare(
      `SELECT * FROM consultations WHERE specialty = ? AND status = 'waiting' ORDER BY created_at ASC LIMIT 1`
    ).get(specialty) as ConsultationRow | undefined;
    if (!next) return undefined;
    db.prepare(`UPDATE consultations SET doctor_id = ?, status = 'assigned', assigned_at = ? WHERE id = ? AND status = 'waiting'`)
      .run(doctorId, now(), next.id);
    return this.getConsultation(next.id);
  },
  startConsultation(id: string, roomId: string) {
    db.prepare(`UPDATE consultations SET status = 'in_progress', room_id = ?, started_at = ? WHERE id = ?`).run(roomId, now(), id);
    return this.getConsultation(id);
  },
  saveNotes(id: string, notesEnc: string) {
    db.prepare(`UPDATE consultations SET notes_enc = ? WHERE id = ?`).run(notesEnc, id);
  },
  completeConsultation(id: string, notesEnc: string | null, summaryEnc: string | null) {
    db.prepare(`UPDATE consultations SET status = 'completed', notes_enc = COALESCE(?, notes_enc), summary_enc = ?, completed_at = ? WHERE id = ?`)
      .run(notesEnc, summaryEnc, now(), id);
    return this.getConsultation(id);
  },
  cancelConsultation(id: string) {
    db.prepare(`UPDATE consultations SET status = 'cancelled', cancelled_at = ? WHERE id = ?`).run(now(), id);
    return this.getConsultation(id);
  },

  // ── auditoría de accesos ──
  logAccess(consultationId: string | null, actorId: string, subjectId: string, action: string) {
    db.prepare(`INSERT INTO access_log (id, consultation_id, actor_id, subject_id, action, at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), consultationId, actorId, subjectId, action, now());
  },

  // ── métricas para el panel de dirección ──
  metrics(sinceISO: string) {
    const one = (sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as any);
    const all = (sql: string, ...p: any[]) => (db.prepare(sql).all(...p) as any[]);

    const byStatus = all(
      `SELECT status, COUNT(*) n FROM consultations WHERE created_at >= ? GROUP BY status`, sinceISO
    ).reduce((acc: any, r: any) => { acc[r.status] = r.n; return acc; }, {});

    const totals = one(
      `SELECT COUNT(*) created,
              SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed,
              SUM(CASE WHEN status='completed' THEN price_cents ELSE 0 END) revenue_cents
       FROM consultations WHERE created_at >= ?`, sinceISO
    );

    const bySpecialty = all(
      `SELECT specialty, COUNT(*) n,
              SUM(CASE WHEN status='completed' THEN price_cents ELSE 0 END) revenue_cents
       FROM consultations WHERE created_at >= ? GROUP BY specialty ORDER BY n DESC`, sinceISO
    );

    const avgWait = one(
      `SELECT AVG((julianday(assigned_at)-julianday(created_at))*86400) s
       FROM consultations WHERE assigned_at IS NOT NULL AND created_at >= ?`, sinceISO
    ).s;

    const doctors = one(
      `SELECT COUNT(*) total,
              SUM(CASE WHEN license_status='verified' THEN 1 ELSE 0 END) verified,
              SUM(CASE WHEN availability='online' THEN 1 ELSE 0 END) online
       FROM doctor_profiles`
    );

    const topDoctors = all(
      `SELECT full_name, specialty, consultations, rating FROM doctor_profiles
       ORDER BY consultations DESC, rating DESC LIMIT 5`
    );

    const queueNow = all(
      `SELECT specialty, COUNT(*) n FROM consultations WHERE status='waiting' GROUP BY specialty ORDER BY n DESC`
    );

    const prescriptions = one(`SELECT COUNT(*) n FROM prescriptions WHERE issued_at >= ?`, sinceISO).n;

    return {
      consultations: {
        created: totals.created || 0,
        completed: totals.completed || 0,
        completionRate: totals.created ? Math.round((totals.completed / totals.created) * 100) : 0,
        byStatus,
      },
      revenueCents: totals.revenue_cents || 0,
      avgWaitSeconds: avgWait ? Math.round(avgWait) : null,
      bySpecialty,
      doctors,
      topDoctors,
      queueNow,
      prescriptions,
    };
  },
  createPrescription(consultationId: string, patientId: string, doctorId: string, code: string, itemsEnc: string, signature: string): PrescriptionRow {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO prescriptions (id, consultation_id, patient_id, doctor_id, code, items_enc, signature, status, issued_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'issued', ?)`
    ).run(id, consultationId, patientId, doctorId, code, itemsEnc, signature, now());
    return this.getPrescription(id)!;
  },
  getPrescription(id: string): PrescriptionRow | undefined {
    return db.prepare(`SELECT * FROM prescriptions WHERE id = ?`).get(id) as PrescriptionRow | undefined;
  },
  getPrescriptionByConsultation(consultationId: string): PrescriptionRow | undefined {
    return db.prepare(`SELECT * FROM prescriptions WHERE consultation_id = ?`).get(consultationId) as PrescriptionRow | undefined;
  },
  listPrescriptionsByPatient(patientId: string): PrescriptionRow[] {
    return db.prepare(`SELECT * FROM prescriptions WHERE patient_id = ? ORDER BY issued_at DESC`).all(patientId) as unknown as PrescriptionRow[];
  },

  // ── pagos ──
  createPayment(consultationId: string, patientId: string, amountCents: number, currency: string, provider: string, status = "pending", paidAt: string | null = null): PaymentRow {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO payments (id, consultation_id, patient_id, amount_cents, currency, status, provider, created_at, paid_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, consultationId, patientId, amountCents, currency, status, provider, now(), paidAt);
    return this.getPayment(id)!;
  },
  getPayment(id: string): PaymentRow | undefined {
    return db.prepare(`SELECT * FROM payments WHERE id = ?`).get(id) as PaymentRow | undefined;
  },
  getPaymentByConsultation(consultationId: string): PaymentRow | undefined {
    return db.prepare(`SELECT * FROM payments WHERE consultation_id = ? ORDER BY created_at DESC LIMIT 1`).get(consultationId) as PaymentRow | undefined;
  },
  setPaymentRef(id: string, ref: string, provider: string) {
    db.prepare(`UPDATE payments SET provider_ref = ?, provider = ? WHERE id = ?`).run(ref, provider, id);
  },
  markPaymentPaid(id: string) {
    db.prepare(`UPDATE payments SET status = 'paid', paid_at = ? WHERE id = ?`).run(now(), id);
    return this.getPayment(id);
  },
  listPaymentsByPatient(patientId: string): PaymentRow[] {
    return db.prepare(`SELECT * FROM payments WHERE patient_id = ? ORDER BY created_at DESC`).all(patientId) as unknown as PaymentRow[];
  },
};

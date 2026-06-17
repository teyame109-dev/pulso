// ── Seguridad ─────────────────────────────────────────────────────────
import {
  scryptSync, randomBytes, timingSafeEqual,
  createCipheriv, createDecipheriv, createHash, createHmac,
} from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "./env.js";

/* ── Contraseñas ──────────────────────────────────────────────────────
   scrypt es un KDF de la librería estándar (cero dependencias nativas).
   Formato almacenado: scrypt$N$salt_hex$hash_hex
   En producción puede sustituirse por argon2id sin cambiar el resto. */
const SCRYPT_N = 16384, KEYLEN = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, KEYLEN, { N: SCRYPT_N });
  return `scrypt$${SCRYPT_N}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [scheme, n, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt") return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(plain, salt, expected.length, { N: Number(n) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/* ── Cifrado de datos de salud (PHI) en reposo ───────────────────────── */
const PHI_KEY = Buffer.from(config.phiKeyHex, "hex"); // 32 bytes

export function encryptPHI(obj: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", PHI_KEY, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${data.toString("base64")}`;
}

export function decryptPHI<T = unknown>(blob: string): T {
  const [ivB, tagB, dataB] = blob.split(".");
  const decipher = createDecipheriv("aes-256-gcm", PHI_KEY, Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  const out = Buffer.concat([decipher.update(Buffer.from(dataB, "base64")), decipher.final()]);
  return JSON.parse(out.toString("utf8")) as T;
}

/* ── Tokens ───────────────────────────────────────────────────────────
   Access: JWT corto (15m). Refresh: JWT con jti; en BBDD guardamos solo el
   hash del token y rotamos en cada uso. */
export function signAccess(userId: string, emailVerified: boolean, role: string): string {
  return jwt.sign({ sub: userId, ev: emailVerified, role, typ: "access" }, config.jwtAccessSecret, {
    expiresIn: config.accessTtl as any,
  });
}

export function verifyAccess(token: string): { sub: string; ev: boolean; role: string } {
  const p = jwt.verify(token, config.jwtAccessSecret) as any;
  if (p.typ !== "access") throw new Error("token inválido");
  return { sub: p.sub, ev: p.ev, role: p.role };
}

export function signRefresh(userId: string, jti: string): string {
  return jwt.sign({ sub: userId, jti, typ: "refresh" }, config.jwtRefreshSecret, {
    expiresIn: `${config.refreshTtlDays}d`,
  });
}

export function verifyRefresh(token: string): { sub: string; jti: string } {
  const p = jwt.verify(token, config.jwtRefreshSecret) as any;
  if (p.typ !== "refresh") throw new Error("token inválido");
  return { sub: p.sub, jti: p.jti };
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/* ── 2FA · TOTP (RFC 6238) con la librería estándar ─────────────────── */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str: string): Buffer {
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of str.replace(/=+$/, "").toUpperCase()) {
    const idx = B32.indexOf(ch); if (idx < 0) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20)); // 160 bits, estándar
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(buf).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 1_000_000).padStart(6, "0");
}

export function totpVerify(secretB32: string, code: string, window = 1): boolean {
  const secret = base32Decode(secretB32);
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let i = -window; i <= window; i++) {
    if (timingSafeEqual(Buffer.from(hotp(secret, counter + i)), Buffer.from(code.padStart(6, "0").slice(0, 6)))) return true;
  }
  return false;
}

export function otpauthUri(email: string, secretB32: string): string {
  const label = encodeURIComponent(`Pulso:${email}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=Pulso&algorithm=SHA1&digits=6&period=30`;
}

export function generateBackupCodes(n = 8): { plain: string[]; hashes: string[] } {
  const plain: string[] = [], hashes: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = randomBytes(4).toString("hex"); // 8 hex
    const formatted = `${c.slice(0, 4)}-${c.slice(4)}`;
    plain.push(formatted); hashes.push(sha256(formatted));
  }
  return { plain, hashes };
}

/* ── Token temporal de desafío 2FA (entre password OK y código) ─────── */
export function signTwofaChallenge(userId: string): string {
  return jwt.sign({ sub: userId, typ: "2fa" }, config.jwtAccessSecret, { expiresIn: "5m" });
}
export function verifyTwofaChallenge(token: string): { sub: string } {
  const p = jwt.verify(token, config.jwtAccessSecret) as any;
  if (p.typ !== "2fa") throw new Error("token inválido");
  return { sub: p.sub };
}

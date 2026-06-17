// Cliente de la API de Pulso: maneja tokens, refresh automático en 401 y
// expone funciones por endpoint. La sesión se guarda en localStorage.
// Si no se define VITE_API_URL, se usa el mismo origen (despliegue de servicio
// único: el backend sirve el front). En desarrollo separado, apunta al :3001.
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";

type Tokens = { accessToken: string; refreshToken: string };
const KEY = "pulso.session";

export function loadSession(): Tokens | null {
  try { const r = localStorage.getItem(KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}
export function saveSession(t: Tokens) { localStorage.setItem(KEY, JSON.stringify(t)); }
export function clearSession() { localStorage.removeItem(KEY); }

async function refresh(): Promise<boolean> {
  const s = loadSession();
  if (!s) return false;
  const res = await fetch(`${BASE}/v1/auth/refresh`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: s.refreshToken }),
  });
  if (!res.ok) { clearSession(); return false; }
  const data = await res.json();
  saveSession({ accessToken: data.accessToken, refreshToken: data.refreshToken });
  return true;
}

export class ApiError extends Error {
  status: number; code?: string; data: any;
  constructor(status: number, data: any) {
    super(data?.message || data?.error || `Error ${status}`);
    this.status = status; this.code = data?.error; this.data = data;
  }
}

interface Opts { method?: string; body?: unknown; auth?: boolean; retry?: boolean; }

export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const { method = "GET", body, auth = false, retry = true } = opts;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const s = loadSession();
    if (s) headers["Authorization"] = `Bearer ${s.accessToken}`;
  }
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth && retry) {
    if (await refresh()) return api<T>(path, { ...opts, retry: false });
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

// SSE: devuelve un EventSource autenticado por query (?access_token=).
export function eventStream(path: string): EventSource {
  const s = loadSession();
  const sep = path.includes("?") ? "&" : "?";
  return new EventSource(`${BASE}${path}${sep}access_token=${s?.accessToken ?? ""}`);
}

/* ── Endpoints ── */
export const Api = {
  // auth
  register: (email: string, password: string) => api("/v1/auth/register", { method: "POST", body: { email, password } }),
  verifyEmail: (token: string) => api("/v1/auth/verify-email", { method: "POST", body: { token } }),
  login: (email: string, password: string) => api("/v1/auth/login", { method: "POST", body: { email, password } }),
  twofaVerify: (challengeToken: string, code: string) => api("/v1/auth/2fa/verify", { method: "POST", body: { challengeToken, code } }),
  me: () => api("/v1/auth/me", { auth: true }),
  // paciente
  getProfile: () => api("/v1/patients/me/profile", { auth: true }),
  history: () => api("/v1/patients/me/history", { auth: true }),
  saveProfile: (profile: any) => api("/v1/patients/me/profile", { method: "PUT", auth: true, body: profile }),
  createConsultation: (specialty: string, reason: string) => api("/v1/consultations", { method: "POST", auth: true, body: { specialty, reason } }),
  myConsultations: () => api("/v1/consultations/me", { auth: true }),
  getConsultation: (id: string) => api(`/v1/consultations/${id}`, { auth: true }),
  cancelConsultation: (id: string) => api(`/v1/consultations/${id}/cancel`, { method: "POST", auth: true }),
  // médico
  setAvailability: (status: string) => api("/v1/doctors/me/availability", { method: "PUT", auth: true, body: { status } }),
  doctorMe: () => api("/v1/doctors/me", { auth: true }),
  doctorOnboarding: (data: any) => api("/v1/doctors/me/onboarding", { method: "POST", auth: true, body: data }),
  doctorEarnings: (from: string, to: string) => api(`/v1/doctor/earnings?from=${from}&to=${to}`, { auth: true }),
  uploadDocument: async (type: string, file: File) => {
    const s = loadSession();
    const fd = new FormData();
    fd.append("type", type);
    fd.append("file", file);
    const res = await fetch(`${BASE}/v1/doctors/me/documents`, { method: "POST", headers: s ? { Authorization: `Bearer ${s.accessToken}` } : {}, body: fd });
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
    return res.json();
  },
  queue: () => api("/v1/doctor/queue", { auth: true }),
  claimNext: () => api("/v1/doctor/consultations/next", { method: "POST", auth: true }),
  doctorConsultation: (id: string) => api(`/v1/doctor/consultations/${id}`, { auth: true }),
  start: (id: string) => api(`/v1/consultations/${id}/start`, { method: "POST", auth: true }),
  complete: (id: string, notes: string, summary: string) => api(`/v1/consultations/${id}/complete`, { method: "POST", auth: true, body: { notes, summary } }),
  // receta
  issuePrescription: (id: string, items: any[]) => api(`/v1/consultations/${id}/prescription`, { method: "POST", auth: true, body: { items } }),
  consultationPrescription: (id: string) => api(`/v1/consultations/${id}/prescription`, { auth: true }),
  getPrescription: (id: string) => api(`/v1/prescriptions/${id}`, { auth: true }),
  myPrescriptions: () => api("/v1/prescriptions/me", { auth: true }),
  // pagos
  consultationPayment: (id: string) => api(`/v1/consultations/${id}/payment`, { auth: true }),
  checkout: (paymentId: string) => api(`/v1/payments/${paymentId}/checkout`, { method: "POST", auth: true }),
  confirmPaymentDemo: (paymentId: string) => api(`/v1/payments/${paymentId}/confirm-demo`, { method: "POST", auth: true }),
  myPayments: () => api("/v1/payments/me", { auth: true }),
  // admin
  metrics: (period: string) => api(`/v1/admin/metrics?period=${period}`, { auth: true }),
};

export const API_BASE = BASE;

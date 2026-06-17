import { useEffect, useState } from "react";
import { Api, ApiError, saveSession, clearSession, loadSession } from "./api";
import { Logo, Field } from "./ui";

type View = "loading" | "login" | "dashboard";

export default function AdminApp() {
  const [view, setView] = useState<View>("loading");
  useEffect(() => { void boot(); }, []);
  async function boot() {
    if (!loadSession()) { setView("login"); return; }
    try { const me: any = await Api.me(); setView(me.user.role === "admin" ? "dashboard" : "login"); }
    catch { clearSession(); setView("login"); }
  }
  if (view === "loading") return <div style={{ padding: 40, textAlign: "center", color: "var(--ink3)" }}>Cargando…</div>;
  if (view === "login") return <AdminLogin onAuthed={() => setView("dashboard")} />;
  return <Dashboard onLogout={() => { clearSession(); setView("login"); }} />;
}

function AdminLogin({ onAuthed }: any) {
  const [email, setEmail] = useState("admin@pulso.es");
  const [pass, setPass] = useState("CambiaEstoYa_2026");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function submit() {
    setErr(""); setBusy(true);
    try {
      const r: any = await Api.login(email, pass);
      if (r.twofaRequired) { setErr("Esta cuenta tiene 2FA. Para la demo usa el admin sembrado."); return; }
      saveSession({ accessToken: r.accessToken, refreshToken: r.refreshToken });
      onAuthed();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "No se pudo conectar."); } finally { setBusy(false); }
  }
  return (
    <div style={{ maxWidth: 380, margin: "60px auto", padding: "0 18px" }}>
      <div style={{ textAlign: "center", marginBottom: 18 }}><Logo size={34} /><div className="word" style={{ fontSize: 22, marginTop: 8 }}>Dirección</div></div>
      <div className="banner">Admin de demo: <b>admin@pulso.es</b> / <b>CambiaEstoYa_2026</b></div>
      <div className="card">
        <label className="lbl">Correo</label>
        <Field type="email" value={email} onChange={(e: any) => setEmail(e.target.value)} />
        <label className="lbl">Contraseña</label>
        <Field type="password" value={pass} onChange={(e: any) => setPass(e.target.value)} />
        {err && <div className="err">{err}</div>}
        <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={busy} onClick={submit}>{busy ? "…" : "Entrar"}</button>
      </div>
    </div>
  );
}

const PERIODS: Array<[string, string]> = [["today", "Hoy"], ["7d", "7 días"], ["30d", "30 días"]];
const eur = (cents: number) => (cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [period, setPeriod] = useState("30d");
  const [m, setM] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Api.metrics(period).then((r: any) => setM(r.metrics)).catch(() => setM(null)).finally(() => setLoading(false));
  }, [period]);

  const maxSpec = m ? Math.max(1, ...m.bySpecialty.map((s: any) => s.n)) : 1;

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "8px 22px 60px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ fontFamily: "var(--display)", fontSize: 26, letterSpacing: "-.02em" }}>Panel de dirección</h1>
          <p className="sub">Operación de Pulso en tiempo real</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div className="tabs">
            {PERIODS.map(([k, label]) => (
              <button key={k} className={"tab" + (period === k ? " on" : "")} onClick={() => setPeriod(k)}>{label}</button>
            ))}
          </div>
          <button className="reset" onClick={onLogout}>salir</button>
        </div>
      </div>

      {loading && <div style={{ color: "var(--ink3)", padding: 30 }}>Cargando métricas…</div>}
      {!loading && !m && <div className="err">No se pudieron cargar las métricas. ¿Está el backend en marcha?</div>}

      {!loading && m && (
        <>
          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14, marginBottom: 16 }}>
            <Kpi label="Ingresos" value={eur(m.revenueCents)} accent />
            <Kpi label="Consultas completadas" value={m.consultations.completed} />
            <Kpi label="Tasa de finalización" value={m.consultations.completionRate + "%"} />
            <Kpi label="Espera media" value={m.avgWaitSeconds != null ? m.avgWaitSeconds + " s" : "—"} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 14 }} className="dash-cols">
            {/* Por especialidad */}
            <div className="card">
              <div style={{ fontFamily: "var(--display)", fontWeight: 700, marginBottom: 14 }}>Consultas por especialidad</div>
              {m.bySpecialty.length === 0 && <p className="sub">Sin datos en este periodo.</p>}
              {m.bySpecialty.map((s: any) => (
                <div key={s.specialty} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                    <span>{s.specialty}</span><b>{s.n} · {eur(s.revenue_cents)}</b>
                  </div>
                  <div style={{ height: 8, background: "var(--bg)", borderRadius: 6, overflow: "hidden" }}>
                    <div style={{ width: `${(s.n / maxSpec) * 100}%`, height: "100%", background: "var(--brand)", borderRadius: 6 }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Equipo médico */}
            <div className="card">
              <div style={{ fontFamily: "var(--display)", fontWeight: 700, marginBottom: 14 }}>Equipo médico</div>
              <div className="row"><span>Médicos verificados</span><b>{m.doctors.verified} / {m.doctors.total}</b></div>
              <div className="row"><span>Disponibles ahora</span><b style={{ color: m.doctors.online > 0 ? "var(--brand)" : "var(--ink2)" }}>{m.doctors.online}</b></div>
              <div className="row"><span>Recetas emitidas</span><b>{m.prescriptions}</b></div>
              <div style={{ fontFamily: "var(--display)", fontWeight: 700, margin: "16px 0 8px" }}>Más activos</div>
              {m.topDoctors.filter((t: any) => t.consultations > 0).map((t: any) => (
                <div key={t.full_name} className="row"><span>{t.full_name}<br /><span className="sub">{t.specialty}</span></span><b>{t.consultations} · ★{t.rating}</b></div>
              ))}
            </div>
          </div>

          {/* Cola en vivo */}
          <div className="card" style={{ marginTop: 14 }}>
            <div style={{ fontFamily: "var(--display)", fontWeight: 700, marginBottom: 10 }}>Cola ahora mismo</div>
            {m.queueNow.length === 0 ? <p className="sub">No hay pacientes en espera.</p> :
              <div className="chips">{m.queueNow.map((q: any) => <span key={q.specialty} className="chip on">{q.specialty}: {q.n}</span>)}</div>}
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: any; accent?: boolean }) {
  return (
    <div className="card" style={{ margin: 0, background: accent ? "var(--deep)" : "#fff" }}>
      <div style={{ fontSize: 12, color: accent ? "rgba(255,255,255,.7)" : "var(--ink3)", marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: "var(--display)", fontWeight: 800, fontSize: 28, letterSpacing: "-.02em", color: accent ? "#fff" : "var(--ink)" }}>{value}</div>
    </div>
  );
}

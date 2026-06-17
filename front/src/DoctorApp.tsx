import { useEffect, useRef, useState } from "react";
import { Api, ApiError, saveSession, clearSession, loadSession, eventStream } from "./api";
import { Logo, Pulse, PhoneFrame, Field } from "./ui";
import { PrescriptionCard } from "./receta";
import { printSettlement } from "./liquidacion";

type View = "loading" | "login" | "onboarding" | "queue" | "consult" | "earnings";

export default function DoctorApp() {
  const [view, setView] = useState<View>("loading");
  const [me, setMe] = useState<any>(null);

  useEffect(() => { void boot(); }, []);
  async function boot() {
    if (!loadSession()) { setView("login"); return; }
    try {
      const who: any = await Api.me();
      if (who.user.role !== "doctor") { clearSession(); setView("login"); return; }
      const d: any = await Api.doctorMe();
      setMe(d.doctor);
      setView(d.doctor.onboardingComplete ? "queue" : "onboarding");
    } catch { clearSession(); setView("login"); }
  }
  const logout = () => { clearSession(); setView("login"); };

  return (
    <PhoneFrame>
      <div className="statusbar">
        <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <Logo size={18} /><b style={{ fontFamily: "var(--display)", fontSize: 15 }}>Pulso</b>
          <span style={{ color: "var(--ink3)", fontSize: 13 }}>· Médicos</span>
        </span>
        {view !== "login" && view !== "loading" && <button onClick={logout} className="reset">salir</button>}
      </div>
      {view === "loading" && <div className="center"><Pulse size={48} color="#0C6B5A" /></div>}
      {view === "login" && <DoctorLogin onAuthed={boot} />}
      {view === "onboarding" && <DoctorOnboarding onDone={boot} />}
      {view === "queue" && <Queue onOpen={() => setView("consult")} onEarnings={() => setView("earnings")} />}
      {view === "consult" && <Consult onClose={() => setView("queue")} />}
      {view === "earnings" && <Earnings me={me} onBack={() => setView("queue")} />}
    </PhoneFrame>
  );
}

/* ───────────── ONBOARDING / ALTA DEL MÉDICO ───────────── */
function DoctorOnboarding({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState<any>({ degreeTitle: "", insurer: "", policyNumber: "", policyExpiry: "", iban: "", holder: "" });
  const [titulo, setTitulo] = useState<File | null>(null);
  const [seguro, setSeguro] = useState<File | null>(null);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));

  async function submit() {
    setErr("");
    if (!f.degreeTitle || !f.insurer || !f.policyNumber || !f.policyExpiry || !f.iban || !f.holder) { setErr("Completa todos los campos."); return; }
    setBusy(true);
    try {
      await Api.doctorOnboarding(f);
      if (titulo) await Api.uploadDocument("titulacion", titulo).catch(() => {});
      if (seguro) await Api.uploadDocument("seguro", seguro).catch(() => {});
      onDone();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "No se pudo guardar."); } finally { setBusy(false); }
  }

  return (
    <div className="scroll">
      <h2 className="h1">Completa tu alta</h2>
      <p className="sub">Necesitamos validar tu titulación, tu seguro y tus datos de cobro.</p>

      <label className="lbl">Titulación</label>
      <Field value={f.degreeTitle} onChange={(e: any) => set("degreeTitle", e.target.value)} placeholder="Lic. Medicina, Universidad…" />
      <FileRow label="Subir título (PDF/imagen)" file={titulo} onFile={setTitulo} />

      <div style={{ fontFamily: "var(--display)", fontWeight: 700, margin: "16px 0 2px" }}>Seguro de responsabilidad civil</div>
      <label className="lbl">Aseguradora</label>
      <Field value={f.insurer} onChange={(e: any) => set("insurer", e.target.value)} placeholder="Mapfre, AXA…" />
      <label className="lbl">Nº de póliza</label>
      <Field value={f.policyNumber} onChange={(e: any) => set("policyNumber", e.target.value)} placeholder="RC-12345" />
      <label className="lbl">Vigencia hasta</label>
      <Field type="date" value={f.policyExpiry} onChange={(e: any) => set("policyExpiry", e.target.value)} />
      <FileRow label="Subir póliza (PDF/imagen)" file={seguro} onFile={setSeguro} />

      <div style={{ fontFamily: "var(--display)", fontWeight: 700, margin: "16px 0 2px" }}>Datos bancarios</div>
      <p className="sub">Para tus liquidaciones. Se guardan cifrados.</p>
      <label className="lbl">IBAN</label>
      <Field value={f.iban} onChange={(e: any) => set("iban", e.target.value)} placeholder="ES91 2100 0418 4502 0005 1332" />
      <label className="lbl">Titular de la cuenta</label>
      <Field value={f.holder} onChange={(e: any) => set("holder", e.target.value)} placeholder="Nombre y apellidos" />

      {err && <div className="err">{err}</div>}
      <button className="btn btn-primary" style={{ marginTop: 16 }} disabled={busy} onClick={submit}>{busy ? "Guardando…" : "Completar alta"}</button>
    </div>
  );
}

function FileRow({ label, file, onFile }: { label: string; file: File | null; onFile: (f: File | null) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, border: "1px dashed var(--line)", borderRadius: 12, padding: "11px 13px", marginTop: 8, cursor: "pointer", fontSize: 13, color: file ? "var(--brand)" : "var(--ink2)" }}>
      <span style={{ fontSize: 18 }}>{file ? "✓" : "↑"}</span>
      <span>{file ? file.name : label}</span>
      <input type="file" accept="application/pdf,image/*" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0] || null)} />
    </label>
  );
}

function DoctorLogin({ onAuthed }: any) {
  const [email, setEmail] = useState("doctor@pulso.es");
  const [pass, setPass] = useState("Doctor2026");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);

  async function submit() {
    setErr(""); setBusy(true);
    try {
      const r: any = await Api.login(email, pass);
      if (r.twofaRequired) { setErr("Esta cuenta de médico tiene 2FA activado. Desactívalo o usa el médico de demo."); return; }
      saveSession({ accessToken: r.accessToken, refreshToken: r.refreshToken });
      onAuthed();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "No se pudo conectar."); } finally { setBusy(false); }
  }

  return (
    <div className="scroll">
      <div style={{ textAlign: "center", padding: "22px 0 18px" }}>
        <Logo size={34} /><div className="word" style={{ fontSize: 24, marginTop: 10 }}>Acceso médico</div>
      </div>
      <div className="banner">Médico de demo precargado: <b>doctor@pulso.es</b> / <b>Doctor2026</b></div>
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

function Queue({ onOpen, onEarnings }: { onOpen: () => void; onEarnings: () => void }) {
  const [online, setOnline] = useState(false);
  const [me, setMe] = useState<any>(null);
  const [queue, setQueue] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    Api.doctorMe().then((r: any) => { setMe(r.doctor); setOnline(r.doctor.availability === "online"); }).catch(() => {});
  }, []);

  async function refreshQueue() { try { const r: any = await Api.queue(); setQueue(r.queue); } catch {} }

  useEffect(() => {
    if (!online) { setQueue([]); if (esRef.current) { esRef.current.close(); esRef.current = null; } return; }
    void refreshQueue();
    const es = eventStream("/v1/doctor/queue/events");
    es.addEventListener("queue", () => void refreshQueue());
    esRef.current = es;
    const iv = setInterval(refreshQueue, 5000);
    return () => { es.close(); clearInterval(iv); };
  }, [online]);

  async function toggle() {
    const next = online ? "offline" : "online";
    try { await Api.setAvailability(next); setOnline(!online); } catch {}
  }
  async function takeNext() {
    setBusy(true);
    try { const r: any = await Api.claimNext(); sessionStorage.setItem("pulso.doctor.activeConsultation", r.consultation.id); onOpen(); }
    catch (e) { /* cola vacía */ } finally { setBusy(false); }
  }

  return (
    <div className="scroll">
      <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderColor: online ? "var(--live)" : "var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {online ? <Pulse size={26} /> : <span style={{ width: 12, height: 12, borderRadius: 99, background: "#C6D0CD", display: "inline-block" }} />}
          <div>
            <div style={{ fontWeight: 700 }}>{online ? "Disponible" : "No disponible"}</div>
            <div className="sub">{me ? `${me.fullName} · ${me.specialty}` : ""}</div>
          </div>
        </div>
        <button className="toggle" style={{ background: online ? "var(--live)" : "#CBD3D1" }} onClick={toggle}>
          <span className="knob" style={{ left: online ? 22 : 3 }} />
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "8px 2px 10px" }}>
        <b style={{ fontFamily: "var(--display)", fontSize: 14 }}>En espera</b>
        <button className="reset" style={{ color: "var(--brand)", fontWeight: 600 }} onClick={onEarnings}>Mis liquidaciones →</button>
      </div>

      {!online && <div className="sub" style={{ textAlign: "center", padding: 30 }}>Activa tu disponibilidad para recibir pacientes.</div>}
      {online && queue.length === 0 && <div className="sub" style={{ textAlign: "center", padding: 30 }}>No hay pacientes en espera. Cuando un paciente cree una consulta de tu especialidad, aparecerá aquí en vivo.</div>}

      {queue.map((p, i) => (
        <div key={p.id} className="qitem">
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>Paciente en espera</div>
            <div className="sub" style={{ marginTop: 2 }}>{p.reason}</div>
          </div>
          {i === 0 && <span className="badge">siguiente</span>}
        </div>
      ))}

      {online && queue.length > 0 && (
        <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy} onClick={takeNext}>{busy ? "…" : "Atender al siguiente"}</button>
      )}
    </div>
  );
}

function Consult({ onClose }: any) {
  const [c, setC] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  // receta
  const [rx, setRx] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [med, setMed] = useState(""); const [pos, setPos] = useState(""); const [dur, setDur] = useState("");
  const [rxErr, setRxErr] = useState("");

  useEffect(() => {
    (async () => {
      const mine = sessionStorage.getItem("pulso.doctor.activeConsultation");
      if (mine) {
        const r: any = await Api.doctorConsultation(mine).catch(() => null);
        if (r) { setC(r.consultation); setProfile(r.patientProfile); }
        const ex: any = await Api.consultationPrescription(mine).catch(() => null);
        if (ex) setRx(ex.prescription);
      }
    })();
  }, []);

  function addItem() {
    setRxErr("");
    if (!med.trim() || !pos.trim()) { setRxErr("Indica al menos medicamento y posología."); return; }
    setItems((p) => [...p, { medication: med.trim(), posology: pos.trim(), duration: dur.trim() }]);
    setMed(""); setPos(""); setDur("");
  }
  async function issue() {
    if (items.length === 0) { setRxErr("Añade al menos un medicamento."); return; }
    setBusy(true);
    try { const r: any = await Api.issuePrescription(c.id, items); setRx(r.prescription); setItems([]); }
    catch (e) { setRxErr(e instanceof ApiError ? e.message : "Error al emitir."); } finally { setBusy(false); }
  }

  async function start() {
    if (!c) return;
    setBusy(true);
    try { const r: any = await Api.start(c.id); setC(r.consultation); } catch {} finally { setBusy(false); }
  }
  async function complete() {
    if (!c) return;
    setBusy(true);
    try { await Api.complete(c.id, notes, "Sin signos de alarma."); onClose(); } catch {} finally { setBusy(false); }
  }

  if (!c) return <div className="center"><Pulse size={48} color="#0C6B5A" /><p className="sub" style={{ marginTop: 14 }}>Cargando consulta…</p></div>;

  return (
    <div className="scroll">
      <h2 className="h1">Consulta</h2>
      <div className="card">
        <div className="row"><span>Estado</span><b>{c.status}</b></div>
        <div className="row"><span>Motivo</span><b style={{ maxWidth: "60%", textAlign: "right" }}>{c.reason}</b></div>
        {c.roomId && <div className="row"><span>Sala</span><b>{c.roomId}</b></div>}
      </div>
      {profile && (
        <div className="card">
          <div style={{ fontWeight: 700, fontFamily: "var(--display)", marginBottom: 8 }}>Historial del paciente</div>
          <div className="row"><span>Sexo</span><b>{profile.sex}</b></div>
          {profile.chronic?.length > 0 && <div className="row"><span>Condiciones</span><b>{profile.chronic.join(", ")}</b></div>}
          {profile.allergies?.length > 0 && <div className="row"><span>Alergias</span><b>{profile.allergies.join(", ")}</b></div>}
        </div>
      )}

      <label className="lbl">Notas de consulta</label>
      <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Lesión pigmentada benigna…" />

      {/* Receta */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "18px 2px 8px" }}>
        <b style={{ fontFamily: "var(--display)", fontSize: 15 }}>Receta</b>
        {rx && <span className="badge">{rx.code}</span>}
      </div>
      {rx ? (
        <PrescriptionCard doc={rx} />
      ) : (
        <div className="card">
          {items.map((i, n) => (
            <div key={n} className="row"><span><b>{i.medication}</b></span><b style={{ fontWeight: 500 }}>{i.posology}{i.duration ? ` · ${i.duration}` : ""}</b></div>
          ))}
          <label className="lbl">Medicamento</label>
          <Field value={med} onChange={(e: any) => setMed(e.target.value)} placeholder="Hidrocortisona crema 1%" />
          <label className="lbl">Posología</label>
          <Field value={pos} onChange={(e: any) => setPos(e.target.value)} placeholder="Aplicar 2 veces al día" />
          <label className="lbl">Duración</label>
          <Field value={dur} onChange={(e: any) => setDur(e.target.value)} placeholder="7 días" />
          {rxErr && <div className="err">{rxErr}</div>}
          <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={addItem}>+ Añadir medicamento</button>
          {items.length > 0 && <button className="btn btn-primary" style={{ marginTop: 8 }} disabled={busy} onClick={issue}>{busy ? "…" : "Emitir receta"}</button>}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {c.status === "assigned" && <button className="btn btn-ghost" disabled={busy} onClick={start}>Iniciar vídeo</button>}
        <button className="btn btn-primary" disabled={busy} onClick={complete}>Cerrar consulta</button>
      </div>
    </div>
  );
}

/* ───────────── LIQUIDACIONES ───────────── */
function Earnings({ me, onBack }: { me: any; onBack: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try { const r: any = await Api.doctorEarnings(from, to); setData(r); } catch { setData(null); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [from, to]);

  const eur = (c: number) => (c / 100).toLocaleString("es-ES", { minimumFractionDigits: 2 }) + " €";
  const fd = (s: string) => new Date(s).toLocaleDateString("es-ES", { day: "2-digit", month: "short" });

  function download() {
    if (!data) return;
    printSettlement({
      doctorName: me?.fullName || "", specialty: me?.specialty || "",
      from: data.from, to: data.to, payoutPct: data.payoutPct, totals: data.totals, items: data.items,
    });
  }

  return (
    <div className="scroll">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <button className="reset" onClick={onBack}>← Cola</button>
      </div>
      <h2 className="h1">Mis liquidaciones</h2>

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <div style={{ flex: 1 }}>
          <label className="lbl">Desde</label>
          <div className="ifield"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
        </div>
        <div style={{ flex: 1 }}>
          <label className="lbl">Hasta</label>
          <div className="ifield"><input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
      </div>

      {loading && <div className="center" style={{ padding: 30 }}><Pulse size={36} color="#0C6B5A" /></div>}
      {!loading && data && (
        <>
          <div className="card" style={{ marginTop: 14, background: "var(--deep)", color: "#fff" }}>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,.7)" }}>Neto a percibir</div>
            <div style={{ fontFamily: "var(--display)", fontWeight: 800, fontSize: 30 }}>{eur(data.totals.netCents)}</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,.7)", marginTop: 4 }}>{data.totals.count} consultas · bruto {eur(data.totals.grossCents)} · comisión {eur(data.totals.feeCents)} ({100 - data.payoutPct}%)</div>
          </div>

          <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={data.totals.count === 0} onClick={download}>Descargar liquidación</button>

          <div style={{ fontFamily: "var(--display)", fontWeight: 700, margin: "16px 2px 8px" }}>Detalle</div>
          {data.items.length === 0 && <p className="sub" style={{ padding: "4px 2px" }}>Sin consultas en este periodo.</p>}
          {data.items.map((e: any) => (
            <div key={e.id} className="row" style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 12, padding: "11px 14px", marginBottom: 8 }}>
              <span>{fd(e.date)}<br /><span className="sub">bruto {eur(e.grossCents)}</span></span>
              <span style={{ textAlign: "right" }}><b>{eur(e.netCents)}</b><br /><span className="sub">−{eur(e.feeCents)}</span></span>
            </div>
          ))}
          <div style={{ height: 8 }} />
        </>
      )}
      {!loading && !data && <div className="err" style={{ marginTop: 14 }}>No se pudieron cargar las liquidaciones.</div>}
    </div>
  );
}

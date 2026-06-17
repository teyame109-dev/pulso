import { useEffect, useRef, useState } from "react";
import { Api, ApiError, saveSession, clearSession, loadSession, eventStream } from "./api";
import { Logo, Pulse, PhoneFrame, Field } from "./ui";
import { PrescriptionCard, printPrescription } from "./receta";

const CHRONIC = ["Hipertensión", "Diabetes", "Asma", "Colesterol alto", "Tiroides", "Ninguna"];
const ALLERGIES = ["Penicilina", "Polen", "Ácaros", "Frutos secos", "Ninguna"];
const SPECIALTIES = ["Dermatología", "Medicina general", "Urología", "Ginecología", "Pediatría", "Nutrición"];

type View = "loading" | "auth" | "verify" | "onboarding" | "edit" | "app" | "consultation";

export default function PatientApp() {
  const [view, setView] = useState<View>("loading");
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => { void boot(); }, []);
  async function boot() {
    if (!loadSession()) { setView("auth"); return; }
    try {
      const me: any = await Api.me();
      if (me.user.role !== "patient") { clearSession(); setView("auth"); return; }
      const active = await findActive();
      if (active) { setActiveId(active); setView("consultation"); }
      else setView(me.user.hasProfile ? "app" : "onboarding");
    } catch { clearSession(); setView("auth"); }
  }
  async function findActive(): Promise<string | null> {
    try {
      const r: any = await Api.myConsultations();
      const a = r.consultations.find((c: any) => ["pending_payment", "waiting", "assigned", "in_progress"].includes(c.status));
      return a?.id ?? null;
    } catch { return null; }
  }

  const logout = () => { clearSession(); setActiveId(null); setView("auth"); };

  return (
    <PhoneFrame>
      <div className="statusbar">
        <span style={{ display: "flex", alignItems: "center", gap: 7 }}><Logo size={18} /><b style={{ fontFamily: "var(--display)", fontSize: 15 }}>Pulso</b></span>
        {view !== "auth" && view !== "loading" && <button onClick={logout} className="reset">salir</button>}
      </div>

      {view === "loading" && <div className="center"><Pulse size={48} color="#0C6B5A" /></div>}
      {view === "auth" && <Auth onAuthed={boot} onNeedVerify={() => setView("verify")} />}
      {view === "verify" && <Verify onDone={() => setView("auth")} />}
      {view === "onboarding" && <Onboarding onDone={() => setView("app")} />}
      {view === "edit" && <Onboarding edit onDone={() => setView("app")} onCancel={() => setView("app")} />}
      {view === "app" && <PatientShell onStart={(id: string) => { setActiveId(id); setView("consultation"); }} onEdit={() => setView("edit")} />}
      {view === "consultation" && activeId && <Consultation id={activeId} onBack={() => setView("app")} />}
    </PhoneFrame>
  );
}

/* ───────────── SHELL con pestañas ───────────── */
function PatientShell({ onStart, onEdit }: { onStart: (id: string) => void; onEdit: () => void }) {
  const [tab, setTab] = useState<"home" | "health">("home");
  return (
    <>
      {tab === "home" ? <Home onStart={onStart} /> : <History onEdit={onEdit} />}
      <div className="tabbar">
        <button className={"tabbar-btn" + (tab === "home" ? " on" : "")} onClick={() => setTab("home")}>
          <Pulse size={tab === "home" ? 16 : 0} /><span>Consulta</span>
        </button>
        <button className={"tabbar-btn" + (tab === "health" ? " on" : "")} onClick={() => setTab("health")}>
          <span>Mi salud</span>
        </button>
      </div>
    </>
  );
}

/* ───────────── AUTH ───────────── */
function Auth({ onAuthed, onNeedVerify }: any) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setErr(""); setBusy(true);
    try {
      if (mode === "signup") {
        const r: any = await Api.register(email, pass);
        // En demo el backend devuelve el enlace de verificación: lo guardamos para la pantalla de verificación.
        sessionStorage.setItem("pulso.verifyUrl", r._demo_verifyUrl || "");
        sessionStorage.setItem("pulso.cred", JSON.stringify({ email, pass }));
        onNeedVerify();
      } else {
        const r: any = await Api.login(email, pass);
        if (r.twofaRequired) { setErr("Esta cuenta tiene 2FA; usa el panel de médico para la demo."); return; }
        saveSession({ accessToken: r.accessToken, refreshToken: r.refreshToken });
        onAuthed();
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "No se pudo conectar con el servidor.");
    } finally { setBusy(false); }
  }

  return (
    <div className="scroll">
      <div style={{ textAlign: "center", padding: "22px 0 18px" }}>
        <Logo size={34} /><div className="word" style={{ fontSize: 26, marginTop: 10 }}>Pulso</div>
        <div className="sub">El médico, ahora</div>
      </div>
      <div className="card">
        <div className="switch">
          <button className={mode === "login" ? "on" : ""} onClick={() => { setMode("login"); setErr(""); }}>Entrar</button>
          <button className={mode === "signup" ? "on" : ""} onClick={() => { setMode("signup"); setErr(""); }}>Crear cuenta</button>
        </div>
        <label className="lbl">Correo electrónico</label>
        <Field type="email" value={email} onChange={(e: any) => setEmail(e.target.value)} placeholder="tu@correo.com" />
        <label className="lbl">Contraseña</label>
        <Field type="password" value={pass} onChange={(e: any) => setPass(e.target.value)} placeholder="······" />
        {err && <div className="err">{err}</div>}
        <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={busy} onClick={submit}>
          {busy ? "…" : mode === "login" ? "Entrar" : "Continuar"}
        </button>
      </div>
    </div>
  );
}

/* ───────────── VERIFY (demo) ───────────── */
function Verify({ onDone }: any) {
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const url = sessionStorage.getItem("pulso.verifyUrl") || "";
  const token = url.split("token=")[1] || "";

  async function verify() {
    setBusy(true);
    try { await Api.verifyEmail(token); setDone(true); } catch { /* */ } finally { setBusy(false); }
  }

  return (
    <div className="center">
      <Pulse size={64} color="#0C6B5A" />
      <h2 className="h2" style={{ marginTop: 22 }}>Verifica tu correo</h2>
      <p className="sub" style={{ marginTop: 6 }}>Te enviamos un enlace de verificación. En una app real llega por email; en esta demo puedes confirmarlo aquí.</p>
      {!done ? (
        <button className="btn btn-primary" style={{ marginTop: 20 }} disabled={busy || !token} onClick={verify}>
          {busy ? "…" : "Verificar ahora (demo)"}
        </button>
      ) : (
        <>
          <div className="banner" style={{ marginTop: 20 }}>Correo verificado. Ya puedes iniciar sesión.</div>
          <button className="btn btn-primary" onClick={onDone}>Ir a iniciar sesión</button>
        </>
      )}
    </div>
  );
}

/* ───────────── ONBOARDING / EDICIÓN ───────────── */
function Onboarding({ onDone, edit, onCancel }: any) {
  const [f, setF] = useState<any>({ name: "", dob: "", sex: "", chronic: [], allergies: [], cAssist: false, cTerms: false, cReco: false });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const toggle = (k: string, v: string) => setF((p: any) => ({ ...p, [k]: p[k].includes(v) ? p[k].filter((x: string) => x !== v) : [...p[k], v] }));

  useEffect(() => {
    if (!edit) return;
    Api.getProfile().then((r: any) => {
      const p = r.profile; if (!p) return;
      setF({
        name: p.name || "", dob: p.dob || "", sex: p.sex || "",
        chronic: p.chronic || [], allergies: p.allergies || [],
        cAssist: p.consent?.assist ?? true, cTerms: p.consent?.terms ?? true, cReco: p.consent?.reco ?? false,
      });
    }).catch(() => {});
  }, [edit]);

  async function save() {
    setErr("");
    if (!f.name || !f.dob || !f.sex) { setErr("Completa nombre, fecha de nacimiento y sexo."); return; }
    if (!f.cAssist || !f.cTerms) { setErr("Acepta el tratamiento asistencial y los términos."); return; }
    setBusy(true);
    try {
      await Api.saveProfile({
        name: f.name, dob: f.dob, sex: f.sex, chronic: f.chronic, allergies: f.allergies,
        consent: { assist: f.cAssist, terms: f.cTerms, reco: f.cReco },
      });
      onDone();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Error al guardar."); } finally { setBusy(false); }
  }

  const C = ({ k, label }: any) => (
    <label className={"consent" + (f[k] ? " on" : "")} onClick={() => set(k, !f[k])}>
      <span className={"check" + (f[k] ? " on" : "")}>{f[k] && "✓"}</span><span>{label}</span>
    </label>
  );

  return (
    <div className="scroll">
      <h2 className="h1">{edit ? "Editar mis datos" : "Tu historial"}</h2>
      <p className="sub">{edit ? "Mantén tus datos al día para una mejor atención." : "Con esto el médico te atiende con contexto."}</p>
      <label className="lbl">Nombre y apellidos</label>
      <Field value={f.name} onChange={(e: any) => set("name", e.target.value)} placeholder="Iván Pérez" />
      <label className="lbl">Fecha de nacimiento</label>
      <Field type="date" value={f.dob} onChange={(e: any) => set("dob", e.target.value)} />
      <label className="lbl">Sexo asignado al nacer</label>
      <div className="segrow">{["Mujer", "Hombre", "Intersexual"].map((s) => (
        <button key={s} className={"segbtn" + (f.sex === s ? " on" : "")} onClick={() => set("sex", s)}>{s}</button>
      ))}</div>
      <label className="lbl">Condiciones crónicas</label>
      <div className="chips">{CHRONIC.map((c) => <button key={c} className={"chip" + (f.chronic.includes(c) ? " on" : "")} onClick={() => toggle("chronic", c)}>{c}</button>)}</div>
      <label className="lbl">Alergias</label>
      <div className="chips">{ALLERGIES.map((a) => <button key={a} className={"chip" + (f.allergies.includes(a) ? " on" : "")} onClick={() => toggle("allergies", a)}>{a}</button>)}</div>
      <div style={{ height: 16 }} />
      <C k="cAssist" label={<><b>Tratamiento de mis datos de salud</b> para la asistencia médica. Obligatorio.</>} />
      <C k="cTerms" label={<><b>Acepto los términos</b> y la política de privacidad. Obligatorio.</>} />
      <C k="cReco" label={<><b>Recomendaciones personalizadas</b> según mi historial. Opcional.</>} />
      {err && <div className="err">{err}</div>}
      <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={busy} onClick={save}>{busy ? "…" : edit ? "Guardar cambios" : "Crear mi perfil"}</button>
      {edit && <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onCancel}>Cancelar</button>}
    </div>
  );
}

/* ───────────── HOME ───────────── */
function Home({ onStart }: any) {
  const [profile, setProfile] = useState<any>(null);
  const [spec, setSpec] = useState("Dermatología");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);

  useEffect(() => { Api.getProfile().then((r: any) => setProfile(r.profile)).catch(() => {}); }, []);

  async function create() {
    setErr("");
    if (!reason.trim()) { setErr("Cuéntanos brevemente qué te ocurre."); return; }
    setBusy(true);
    try { const r: any = await Api.createConsultation(spec, reason); onStart(r.consultation.id); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Error."); } finally { setBusy(false); }
  }

  const first = (profile?.name || "").split(" ")[0] || "";

  return (
    <div className="scroll">
      <p className="sub" style={{ marginBottom: 2 }}>Hola{first ? ", " + first : ""}</p>
      <h2 className="h1">¿Qué te ocurre hoy?</h2>
      <div className="banner">En esta demo hay una dermatóloga disponible. Elige <b>Dermatología</b> para ver el matching en vivo.</div>
      <label className="lbl">Especialidad</label>
      <div className="chips">{SPECIALTIES.map((s) => <button key={s} className={"chip" + (spec === s ? " on" : "")} onClick={() => setSpec(s)}>{s}</button>)}</div>
      <label className="lbl">¿Qué notas?</label>
      <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Mancha en el antebrazo que ha cambiado de color…" />
      {err && <div className="err">{err}</div>}
      <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={busy} onClick={create}>{busy ? "…" : "Buscar médico"}</button>

      {profile && (
        <div className="card" style={{ marginTop: 18 }}>
          <div style={{ fontWeight: 700, fontFamily: "var(--display)", marginBottom: 8 }}>Tu perfil clínico</div>
          <div className="row"><span>Sexo</span><b>{profile.sex}</b></div>
          {profile.chronic?.length > 0 && <div className="row"><span>Condiciones</span><b>{profile.chronic.join(", ")}</b></div>}
          {profile.allergies?.length > 0 && <div className="row"><span>Alergias</span><b>{profile.allergies.join(", ")}</b></div>}
        </div>
      )}
    </div>
  );
}

/* ───────────── HISTORIAL · MI SALUD ───────────── */
function History({ onEdit }: { onEdit: () => void }) {
  const [data, setData] = useState<any>(null);
  const [pays, setPays] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      Api.history().then(setData).catch(() => setData(null)),
      Api.myPayments().then((r: any) => setPays(r.payments)).catch(() => setPays([])),
    ]).finally(() => setLoading(false));
  }, []);

  async function download(prescriptionId: string) {
    try { const r: any = await Api.getPrescription(prescriptionId); printPrescription(r.prescription); } catch {}
  }

  const fdate = (s?: string | null) => s ? new Date(s).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : "";
  const statusEs: any = { waiting: "En espera", assigned: "Asignada", in_progress: "En curso", completed: "Finalizada", cancelled: "Cancelada" };

  if (loading) return <div className="center"><Pulse size={40} color="#0C6B5A" /></div>;
  if (!data) return <div className="scroll"><div className="err">No se pudo cargar tu historial.</div></div>;

  const p = data.profile;
  return (
    <div className="scroll">
      <h2 className="h1">Mi salud</h2>

      {/* Datos personales */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <b style={{ fontFamily: "var(--display)" }}>Datos personales</b>
          <button className="reset" style={{ color: "var(--brand)", fontWeight: 600 }} onClick={onEdit}>Editar</button>
        </div>
        {p ? (<>
          <div className="row"><span>Nombre</span><b>{p.name}</b></div>
          <div className="row"><span>Nacimiento</span><b>{p.dob}</b></div>
          <div className="row"><span>Sexo</span><b>{p.sex}</b></div>
        </>) : <p className="sub">Aún no has completado tu cuestionario.</p>}
      </div>

      {/* Salud */}
      {p && (
        <div className="card">
          <b style={{ fontFamily: "var(--display)", display: "block", marginBottom: 8 }}>Cuestionario clínico</b>
          <div className="row"><span>Condiciones crónicas</span><b>{p.chronic?.length ? p.chronic.join(", ") : "Ninguna"}</b></div>
          <div className="row"><span>Alergias</span><b>{p.allergies?.length ? p.allergies.join(", ") : "Ninguna"}</b></div>
        </div>
      )}

      {/* Consultas */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "18px 2px 8px" }}>
        <b style={{ fontFamily: "var(--display)", fontSize: 15 }}>Consultas</b>
        <span className="badge">{data.consultations.length}</span>
      </div>
      {data.consultations.length === 0 && <p className="sub" style={{ padding: "4px 2px" }}>Todavía no tienes consultas.</p>}
      {data.consultations.map((c: any) => (
        <div key={c.id} className="card" style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <b>{c.specialty}</b>
            <span className="badge" style={{ background: c.status === "completed" ? "var(--soft)" : "var(--bg)", color: c.status === "completed" ? "var(--brand)" : "var(--ink2)" }}>{statusEs[c.status]}</span>
          </div>
          <div className="sub" style={{ marginTop: 3 }}>{fdate(c.completedAt || c.createdAt)}{c.doctor ? " · " + c.doctor : ""}</div>
          <div className="sub" style={{ marginTop: 6 }}><b style={{ color: "var(--ink)" }}>Motivo:</b> {c.reason}</div>
          {c.summary && <div className="sub" style={{ marginTop: 4 }}><b style={{ color: "var(--ink)" }}>Informe:</b> {c.summary}</div>}
          {c.hasPrescription && <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => download(c.prescriptionId)}>Descargar receta</button>}
        </div>
      ))}

      {/* Recetas */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "18px 2px 8px" }}>
        <b style={{ fontFamily: "var(--display)", fontSize: 15 }}>Recetas</b>
        <span className="badge">{data.prescriptions.length}</span>
      </div>
      {data.prescriptions.length === 0 && <p className="sub" style={{ padding: "4px 2px" }}>Sin recetas por ahora.</p>}
      {data.prescriptions.map((rx: any) => (
        <div key={rx.id} className="card" style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <b style={{ fontFamily: "var(--display)" }}>{rx.code}</b>
            <span className="sub">{fdate(rx.issuedAt)}</span>
          </div>
          <div className="sub">{rx.doctor} · {rx.medications.join(", ")}</div>
          <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => download(rx.id)}>Descargar</button>
        </div>
      ))}

      {/* Pagos */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "18px 2px 8px" }}>
        <b style={{ fontFamily: "var(--display)", fontSize: 15 }}>Pagos</b>
        <span className="badge">{pays.length}</span>
      </div>
      {pays.length === 0 && <p className="sub" style={{ padding: "4px 2px" }}>Sin pagos por ahora.</p>}
      {pays.map((pp: any) => (
        <div key={pp.id} className="row" style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 12, padding: "11px 14px", marginBottom: 8 }}>
          <span>{fdate(pp.paidAt || pp.createdAt)}<br /><span className="sub">{pp.provider === "demo" ? "Demostración" : "Stripe"}</span></span>
          <span style={{ textAlign: "right" }}><b>{(pp.amountCents / 100).toFixed(2)} {pp.currency.toUpperCase()}</b><br />
            <span className="badge" style={{ background: pp.status === "paid" ? "var(--soft)" : "var(--bg)", color: pp.status === "paid" ? "var(--brand)" : "var(--ink2)" }}>{pp.status === "paid" ? "Pagado" : pp.status}</span>
          </span>
        </div>
      ))}
      <div style={{ height: 8 }} />
    </div>
  );
}
/* ───────────── CHECKOUT (pago) ───────────── */
function Checkout({ consultationId, onPaid, onBack }: { consultationId: string; onPaid: () => void; onBack: () => void }) {
  const [pay, setPay] = useState<any>(null);
  const [specialty, setSpecialty] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    Api.consultationPayment(consultationId).then((r: any) => { setPay(r.payment); setSpecialty(r.specialty); }).catch(() => setErr("No se pudo cargar el pago."));
  }, [consultationId]);

  async function pagar() {
    if (!pay) return;
    setBusy(true); setErr("");
    try {
      const co: any = await Api.checkout(pay.id);
      if (co.provider === "demo") {
        await Api.confirmPaymentDemo(pay.id); // simula la confirmación de Stripe
        onPaid();
      } else {
        setErr("Stripe configurado: el cobro real se completa con Stripe.js en el cliente.");
      }
    } catch (e) { setErr(e instanceof ApiError ? e.message : "No se pudo procesar el pago."); } finally { setBusy(false); }
  }

  if (!pay) return <div className="center"><Pulse size={40} color="#0C6B5A" />{err && <div className="err" style={{ marginTop: 14 }}>{err}</div>}</div>;
  const amount = (pay.amountCents / 100).toFixed(2);

  return (
    <div>
      <h2 className="h1">Confirmar y pagar</h2>
      <p className="sub">Consulta de {specialty.toLowerCase()}.</p>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="row"><span>Consulta de {specialty}</span><b>{amount} €</b></div>
        <div className="row" style={{ borderBottom: "none" }}><span style={{ fontWeight: 600, color: "var(--ink)" }}>Total</span><b style={{ fontSize: 18, fontFamily: "var(--display)" }}>{amount} €</b></div>
      </div>
      {pay.provider === "demo" && <div className="banner">Pago de <b>demostración</b>: no se cobra dinero. En producción, la tarjeta se cobra de forma segura con <b>Stripe</b>.</div>}
      <label className="lbl">Tarjeta</label>
      <div className="ifield"><input value="4242 4242 4242 4242" readOnly style={{ color: "var(--ink3)" }} /></div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <div className="ifield" style={{ flex: 1 }}><input value="12/29" readOnly style={{ color: "var(--ink3)" }} /></div>
        <div className="ifield" style={{ flex: 1 }}><input value="123" readOnly style={{ color: "var(--ink3)" }} /></div>
      </div>
      {err && <div className="err">{err}</div>}
      <button className="btn btn-primary" style={{ marginTop: 16 }} disabled={busy} onClick={pagar}>{busy ? "Procesando…" : `Pagar ${amount} €`}</button>
      <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onBack}>Cancelar</button>
    </div>
  );
}

function Consultation({ id, onBack }: { id: string; onBack: () => void }) {
  const [c, setC] = useState<any>(null);
  const [rx, setRx] = useState<any>(null);
  const esRef = useRef<EventSource | null>(null);

  async function refresh() {
    try {
      const r: any = await Api.getConsultation(id); setC(r.consultation);
      if (r.consultation.status === "completed" && !rx) {
        const p: any = await Api.consultationPrescription(id).catch(() => null);
        if (p) setRx(p.prescription);
      }
    } catch {}
  }

  useEffect(() => {
    void refresh();
    const es = eventStream(`/v1/consultations/${id}/events`);
    es.addEventListener("update", () => void refresh());
    esRef.current = es;
    return () => es.close();
  }, [id]);

  if (!c) return <div className="center"><Pulse size={48} color="#0C6B5A" /></div>;

  const status = c.status;
  return (
    <div className="scroll">
      {status === "pending_payment" && <Checkout consultationId={id} onPaid={() => void refresh()} onBack={async () => { await Api.cancelConsultation(id).catch(() => {}); onBack(); }} />}
      {status === "waiting" && (
        <div className="center">
          <Pulse size={90} color="#16C79A" />
          <h2 className="h2" style={{ marginTop: 26 }}>Buscando {c.specialty.toLowerCase()}…</h2>
          <p className="sub" style={{ marginTop: 4 }}>Te avisamos en cuanto un médico te atienda.</p>
          <button className="btn btn-ghost" style={{ marginTop: 24 }} onClick={async () => { await Api.cancelConsultation(id).catch(() => {}); onBack(); }}>Cancelar</button>
        </div>
      )}
      {(status === "assigned" || status === "in_progress") && (
        <div className="center">
          <Pulse size={70} color="#0C6B5A" />
          <h2 className="h2" style={{ marginTop: 22 }}>{status === "assigned" ? "Médico asignado" : "Consulta en curso"}</h2>
          {c.doctor && <p className="sub" style={{ marginTop: 4 }}>{c.doctor.name} · ★ {c.doctor.rating}</p>}
          {c.roomId && <div className="banner" style={{ marginTop: 18 }}>Sala de vídeo lista: <b>{c.roomId}</b><br/>(la videollamada real se integra con un proveedor WebRTC)</div>}
          <p className="sub" style={{ marginTop: 14 }}>Estado: {status === "assigned" ? "esperando a que el médico inicie" : "en directo"}</p>
        </div>
      )}
      {status === "completed" && (
        <div>
          <div className="center" style={{ paddingBottom: 8 }}>
            <div style={{ fontSize: 40, color: "#0C6B5A" }}>✓</div>
            <h2 className="h2" style={{ marginTop: 10 }}>Consulta finalizada</h2>
            {c.doctor && <p className="sub" style={{ marginTop: 4 }}>{c.doctor.name}</p>}
            <div className="banner" style={{ marginTop: 14 }}>Importe: {(c.priceCents / 100).toFixed(2)} €</div>
          </div>
          {rx ? <PrescriptionCard doc={rx} /> : <div className="sub" style={{ textAlign: "center", padding: "10px 0" }}>El médico no emitió receta en esta consulta.</div>}
          <button className="btn btn-primary" style={{ marginTop: 6 }} onClick={onBack}>Volver al inicio</button>
        </div>
      )}
      {status === "cancelled" && (
        <div className="center">
          <h2 className="h2">Consulta cancelada</h2>
          <button className="btn btn-primary" style={{ marginTop: 18 }} onClick={onBack}>Volver al inicio</button>
        </div>
      )}
    </div>
  );
}

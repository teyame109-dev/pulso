// Documento de receta: vista en la app + impresión/descarga (guardar como PDF
// desde el diálogo del navegador). El sello es de integridad; en producción la
// dispensación va por una plataforma de receta electrónica privada homologada.

type Item = { medication: string; dose?: string; posology: string; duration?: string; notes?: string };
type Doc = {
  code: string; issuedAt: string; signature: string; status?: string;
  items: Item[];
  doctor: { name: string; specialty: string; license: string } | null;
  patient: { name: string };
};

function rows(doc: Doc): string {
  return doc.items.map((i) => `
    <tr>
      <td><b>${esc(i.medication)}</b>${i.dose ? " · " + esc(i.dose) : ""}</td>
      <td>${esc(i.posology)}</td>
      <td>${esc(i.duration || "—")}</td>
    </tr>
    ${i.notes ? `<tr class="note"><td colspan="3">Indicaciones: ${esc(i.notes)}</td></tr>` : ""}`).join("");
}
function esc(s: string) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)); }

export function prescriptionHTML(doc: Doc): string {
  const date = new Date(doc.issuedAt).toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Receta ${esc(doc.code)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;font-family:Arial,Helvetica,sans-serif}
    body{padding:40px;color:#0F1B19}
    .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0C6B5A;padding-bottom:16px}
    .brand{font-size:24px;font-weight:800;color:#0C6B5A;letter-spacing:-.5px}
    .brand small{display:block;font-size:11px;color:#56655F;font-weight:400;letter-spacing:0}
    .folio{text-align:right;font-size:12px;color:#56655F}
    .folio b{font-size:15px;color:#0F1B19}
    .meta{display:flex;justify-content:space-between;margin:22px 0}
    .meta div{font-size:13px;line-height:1.6}
    .meta .lbl{color:#8A9893;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
    h2{font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:#0C6B5A;margin:18px 0 8px}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th{text-align:left;background:#F1F5F4;padding:9px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:#56655F}
    td{padding:10px;border-bottom:1px solid #E1E7E5;vertical-align:top}
    tr.note td{background:#F8FAF9;font-size:12px;color:#56655F;padding-top:4px}
    .sign{margin-top:34px;display:flex;justify-content:space-between;align-items:flex-end}
    .seal{font-size:10px;color:#8A9893;max-width:60%;word-break:break-all}
    .firma{text-align:center;font-size:12px;color:#56655F}
    .firma .line{width:200px;border-top:1px solid #0F1B19;margin-bottom:4px}
    .foot{margin-top:30px;font-size:10.5px;color:#8A9893;border-top:1px solid #E1E7E5;padding-top:10px;line-height:1.5}
    @media print{body{padding:0}}
  </style></head><body>
    <div class="head">
      <div class="brand">Pulso<small>Telemedicina</small></div>
      <div class="folio">Folio<br><b>${esc(doc.code)}</b><br>${date}</div>
    </div>
    <div class="meta">
      <div><span class="lbl">Paciente</span><br><b>${esc(doc.patient.name)}</b></div>
      <div style="text-align:right"><span class="lbl">Prescriptor</span><br><b>${doc.doctor ? esc(doc.doctor.name) : ""}</b><br>${doc.doctor ? esc(doc.doctor.specialty) + " · Col. " + esc(doc.doctor.license) : ""}</div>
    </div>
    <h2>Prescripción</h2>
    <table>
      <thead><tr><th>Medicamento</th><th>Posología</th><th>Duración</th></tr></thead>
      <tbody>${rows(doc)}</tbody>
    </table>
    <div class="sign">
      <div class="seal"><b>Sello de integridad</b><br>${esc(doc.signature)}</div>
      <div class="firma"><div class="line"></div>Firma del facultativo</div>
    </div>
    <div class="foot">
      Documento emitido electrónicamente a través de Pulso. La dispensación en farmacia requiere su tramitación
      por una plataforma de receta electrónica privada homologada. El sello de integridad garantiza que el
      contenido no ha sido alterado desde su emisión.
    </div>
  </body></html>`;
}

export function printPrescription(doc: Doc) {
  const w = window.open("", "_blank", "width=720,height=900");
  if (!w) return;
  w.document.write(prescriptionHTML(doc));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

export function PrescriptionCard({ doc }: { doc: Doc }) {
  return (
    <div className="card" style={{ textAlign: "left" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <b style={{ fontFamily: "var(--display)" }}>Receta {doc.code}</b>
        <span className="badge">{doc.status === "issued" ? "Emitida" : doc.status}</span>
      </div>
      {doc.items.map((i, n) => (
        <div key={n} className="row" style={{ alignItems: "flex-start" }}>
          <span style={{ maxWidth: "55%" }}><b>{i.medication}</b>{i.dose ? " · " + i.dose : ""}</span>
          <b style={{ textAlign: "right", fontWeight: 500 }}>{i.posology}{i.duration ? ` · ${i.duration}` : ""}</b>
        </div>
      ))}
      <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => printPrescription(doc)}>Descargar / imprimir receta</button>
    </div>
  );
}

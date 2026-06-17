// Documento de liquidación del médico: resumen del periodo + detalle, imprimible
// y descargable como PDF desde el navegador.
type Item = { date: string; grossCents: number; feeCents: number; netCents: number };
type Settlement = {
  doctorName: string; specialty: string; from: string; to: string; payoutPct: number;
  totals: { count: number; grossCents: number; feeCents: number; netCents: number };
  items: Item[];
};

const eur = (c: number) => (c / 100).toLocaleString("es-ES", { minimumFractionDigits: 2 }) + " €";
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const fdate = (s: string) => new Date(s).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });

export function settlementHTML(s: Settlement): string {
  const rows = s.items.map((i) => `<tr><td>${fdate(i.date)}</td><td style="text-align:right">${eur(i.grossCents)}</td><td style="text-align:right">−${eur(i.feeCents)}</td><td style="text-align:right"><b>${eur(i.netCents)}</b></td></tr>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Liquidación Pulso</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;font-family:Arial,Helvetica,sans-serif}
    body{padding:40px;color:#0F1B19}
    .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0C6B5A;padding-bottom:16px}
    .brand{font-size:24px;font-weight:800;color:#0C6B5A}.brand small{display:block;font-size:11px;color:#56655F;font-weight:400}
    .ttl{text-align:right;font-size:12px;color:#56655F}.ttl b{font-size:15px;color:#0F1B19}
    .meta{margin:20px 0;font-size:13px;line-height:1.7}.meta .lbl{color:#8A9893;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
    .cards{display:flex;gap:12px;margin:18px 0}
    .kpi{flex:1;border:1px solid #E1E7E5;border-radius:10px;padding:12px}
    .kpi .l{font-size:11px;color:#8A9893}.kpi .v{font-size:20px;font-weight:800;color:#0F1B19;margin-top:4px}
    .kpi.net{background:#063F35;color:#fff;border:none}.kpi.net .l{color:rgba(255,255,255,.7)}.kpi.net .v{color:#fff}
    table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:8px}
    th{text-align:left;background:#F1F5F4;padding:9px 10px;font-size:11px;text-transform:uppercase;color:#56655F}
    th:not(:first-child){text-align:right}
    td{padding:9px 10px;border-bottom:1px solid #E1E7E5}
    .foot{margin-top:24px;font-size:10.5px;color:#8A9893;border-top:1px solid #E1E7E5;padding-top:10px;line-height:1.5}
    @media print{body{padding:0}}
  </style></head><body>
    <div class="head"><div class="brand">Pulso<small>Liquidación de honorarios</small></div>
      <div class="ttl">Periodo<br><b>${fdate(s.from)} – ${fdate(s.to)}</b></div></div>
    <div class="meta">
      <span class="lbl">Profesional</span><br><b>${esc(s.doctorName)}</b> · ${esc(s.specialty)}
    </div>
    <div class="cards">
      <div class="kpi"><div class="l">Consultas</div><div class="v">${s.totals.count}</div></div>
      <div class="kpi"><div class="l">Bruto</div><div class="v">${eur(s.totals.grossCents)}</div></div>
      <div class="kpi"><div class="l">Comisión (${100 - s.payoutPct}%)</div><div class="v">−${eur(s.totals.feeCents)}</div></div>
      <div class="kpi net"><div class="l">Neto a percibir</div><div class="v">${eur(s.totals.netCents)}</div></div>
    </div>
    <table><thead><tr><th>Fecha</th><th>Bruto</th><th>Comisión</th><th>Neto</th></tr></thead><tbody>${rows || '<tr><td colspan="4">Sin consultas en el periodo.</td></tr>'}</tbody></table>
    <div class="foot">Documento informativo generado por Pulso. El pago efectivo de las liquidaciones se realiza según el calendario acordado. Importes en euros, impuestos no incluidos salvo indicación.</div>
  </body></html>`;
}

export function printSettlement(s: Settlement) {
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  w.document.write(settlementHTML(s)); w.document.close(); w.focus();
  setTimeout(() => w.print(), 300);
}

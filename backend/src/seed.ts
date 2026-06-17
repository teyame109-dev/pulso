import { repo } from "./db.js";
import { hashPassword, encryptPHI } from "./security.js";
import { config } from "./env.js";

// Crea médicos, pacientes y un histórico de consultas completadas para que el
// panel de dirección tenga datos reales desde el primer arranque (SEED_DEMO).
export function seedDemoData(log: (m: string) => void) {
  if (repo.getUserByEmail("doctor@pulso.es")) return; // ya sembrado

  // Médicos verificados (el primero es el que se usa para la demo interactiva).
  const elena = repo.seedDoctor("doctor@pulso.es", hashPassword("Doctor2026"), "Dra. Elena Ferrer", "Dermatología", "28/4471");
  const marcos = repo.seedDoctor("marcos@pulso.es", hashPassword("Doctor2026"), "Dr. Marcos Vidal", "Medicina general", "28/5120");
  const sara = repo.seedDoctor("sara@pulso.es", hashPassword("Doctor2026"), "Sara Ibáñez", "Nutrición", "28/6033");

  // Alta completa de los médicos de demo (titulación, seguro y banco).
  [["Lic. Medicina, UCM", "Mapfre", "POL-100", "ES7620770024003102575766", "Elena Ferrer"],
   ["Lic. Medicina, UAM", "AXA", "POL-200", "ES9121000418450200051332", "Marcos Vidal"],
   ["Grado Nutrición, URJC", "Caser", "POL-300", "ES7800750000000000000000", "Sara Ibáñez"]
  ].forEach((v, i) => {
    const doc = [elena, marcos, sara][i];
    repo.updateDoctorOnboarding(doc.id, {
      degree_title: v[0], insurer: v[1], policy_number: v[2], policy_expiry: "2027-12-31",
      bank_iban_enc: encryptPHI(v[3]), bank_holder_enc: encryptPHI(v[4]),
    });
  });

  // Pacientes con perfil clínico mínimo.
  const names = ["Lucía Soto", "Pablo Ruiz", "Carmen Gil", "Diego Mora", "Ana Vega"];
  const patients = names.map((name, i) => {
    const u = repo.seedPatient(`demo.paciente${i + 1}@pulso.es`, hashPassword("Secreto123"));
    repo.upsertProfile(u.id, encryptPHI({ name, sex: i % 2 ? "Hombre" : "Mujer", chronic: [], allergies: [] }), { assist: true, terms: true, reco: false });
    return u;
  });

  // Histórico de consultas completadas (precio por especialidad).
  const plan: Array<[any, string, number, string]> = [
    [elena, "Dermatología", 2900, "Revisión de un lunar"],
    [elena, "Dermatología", 2900, "Brote de acné"],
    [elena, "Dermatología", 2900, "Dermatitis en las manos"],
    [elena, "Dermatología", 2900, "Mancha que ha cambiado"],
    [marcos, "Medicina general", 2500, "Dolor de garganta persistente"],
    [marcos, "Medicina general", 2500, "Revisión de analítica"],
    [marcos, "Medicina general", 2500, "Cefaleas frecuentes"],
    [sara, "Nutrición", 3500, "Plan de alimentación"],
    [sara, "Nutrición", 3500, "Control de peso"],
  ];

  let presc = 0;
  plan.forEach(([doc, specialty, price, reason], idx) => {
    const patient = patients[idx % patients.length];
    const c = repo.seedCompletedConsultation(patient.id, doc.id, specialty, encryptPHI(reason), price);
    repo.createPayment(c.id, patient.id, price, "eur", "demo", "paid", new Date().toISOString());
    const net = Math.round((price * config.doctorPayoutPct) / 100);
    repo.createEarning(c.id, doc.id, price, price - net, net);
    // Algunas con receta.
    if (idx % 3 === 0) {
      const code = "RX-" + (100000 + idx).toString(16).toUpperCase();
      const items = [{ medication: "Tratamiento indicado", dose: "", posology: "Según pauta", duration: "según evolución", notes: "" }];
      repo.createPrescription(c.id, patient.id, doc.id, code, encryptPHI(items), "sello_demo_" + idx);
      presc++;
    }
  });

  log(`Datos de demo: 3 médicos, ${patients.length} pacientes, ${plan.length} consultas completadas, ${presc} recetas.`);
}

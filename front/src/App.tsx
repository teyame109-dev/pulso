import { useState } from "react";
import PatientApp from "./PatientApp";
import DoctorApp from "./DoctorApp";
import AdminApp from "./AdminApp";
import { Logo } from "./ui";
import { API_BASE } from "./api";

export default function App() {
  const [side, setSide] = useState<"paciente" | "medico" | "direccion">("paciente");
  return (
    <div style={{ minHeight: "100vh" }}>
      <div className="shell-top">
        <div className="brandrow">
          <Logo size={26} />
          <div><div className="word">Pulso</div><div className="subtag">demo conectada · {API_BASE}</div></div>
        </div>
        <div className="tabs">
          <button className={"tab" + (side === "paciente" ? " on" : "")} onClick={() => setSide("paciente")}>Paciente</button>
          <button className={"tab" + (side === "medico" ? " on" : "")} onClick={() => setSide("medico")}>Médico</button>
          <button className={"tab" + (side === "direccion" ? " on" : "")} onClick={() => setSide("direccion")}>Dirección</button>
        </div>
      </div>
      <div className={side === "direccion" ? "" : "stage"}>
        {side === "paciente" && <PatientApp />}
        {side === "medico" && <DoctorApp />}
        {side === "direccion" && <AdminApp />}
      </div>
    </div>
  );
}

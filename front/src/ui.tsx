import type { ReactNode } from "react";

export function Logo({ size = 24, mono = false }: { size?: number; mono?: boolean }) {
  const col = mono ? "#fff" : "#0C6B5A";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <circle cx="16" cy="16" r="14.5" stroke={col} strokeWidth="1.6" opacity={mono ? 0.55 : 0.4} />
      <path d="M4 16 H10.5 L12.5 9 L16 23 L18.5 13 L20 16 H28" stroke={col} strokeWidth="2.1" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function Pulse({ size = 64, color = "#16C79A" }: { size?: number; color?: string }) {
  return (
    <span className="pulse" style={{ width: size, height: size }} aria-hidden>
      <span className="ring" style={{ borderColor: color }} />
      <span className="ring ring2" style={{ borderColor: color }} />
      <span className="dot" style={{ background: color }} />
    </span>
  );
}

export function PhoneFrame({ children }: { children: ReactNode }) {
  const clock = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="phone">
      <div className="notch" />
      <div className="screen">
        <div className="iosbar"><span>{clock}</span><span>5G</span></div>
        {children}
      </div>
    </div>
  );
}

export function Field({ icon, ...props }: any) {
  return (
    <div className="ifield">
      {icon}
      <input {...props} />
    </div>
  );
}

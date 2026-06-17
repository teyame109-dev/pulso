# Pulso · App (front conectado)

Front de demostración en React + Vite que consume el backend de Pulso. Incluye
la app del **paciente** (registro, verificación, cuestionario, crear consulta y
seguimiento en vivo) y la app del **médico** (disponibilidad, cola en tiempo
real y ciclo de consulta).

## Arrancar

Requiere Node.js 22+ y el backend corriendo (por defecto en `http://localhost:3001`).

```bash
cp .env.example .env     # ajusta VITE_API_URL si tu backend usa otra URL
npm install
npm run dev              # abre http://localhost:5173
```

## Configuración

`.env`:
```
VITE_API_URL=http://localhost:3001
```

El backend debe permitir este origen en CORS: arráncalo con
`CORS_ORIGIN=http://localhost:5173` (es el valor por defecto del `.env.example`
del backend).

## Notas de la demo

- Los emails no se envían: tras registrarte, la pantalla de verificación tiene
  un botón **"Verificar ahora (demo)"** que confirma el correo directamente.
- La videollamada es un identificador de sala; la integración real es con un
  proveedor WebRTC.
- Para ver el matching, en una pestaña entra como paciente y crea una consulta
  de **Dermatología**; en otra, entra como médico (`doctor@pulso.es` /
  `Doctor2026`, sembrado por el backend con `SEED_DEMO=true`), ponte disponible
  y atiende. El estado del paciente cambia en vivo.

## Estructura

```
src/
  api.ts          Cliente de la API (tokens, refresh automático, SSE)
  ui.tsx          Componentes compartidos (logo, pulso, marco de móvil)
  styles.css      Sistema visual de Pulso
  PatientApp.tsx  Flujo del paciente
  DoctorApp.tsx   Flujo del médico
  App.tsx         Selector paciente / médico
```

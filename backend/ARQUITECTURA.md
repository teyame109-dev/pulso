# Pulso — Arquitectura técnica del backend

Documento de referencia para el equipo técnico. Define el stack concreto, las
decisiones de seguridad y cumplimiento, el modelo de datos y cómo encaja el
módulo de autenticación ya construido dentro del conjunto.

Pulso es una plataforma de telemedicina con tres frentes: la app del paciente,
la app del médico (modelo de plantilla/colaboradores propios, tipo BPO) y el
panel de dirección. El backend les da servicio a los tres.

---

## 1. Principio rector

Pulso maneja datos de salud, que el RGPD clasifica como **categoría especial**
(art. 9). Eso convierte la seguridad y la minimización de datos en requisitos
de arquitectura, no en añadidos. Tres consecuencias que atraviesan todo el
diseño: cifrado del historial en reposo y en tránsito, residencia de datos en
la UE, y separación estricta de finalidades (asistencial vs. comercial) con
consentimiento granular.

---

## 2. Stack concreto

Un único lenguaje de extremo a extremo (TypeScript) para facilitar la
contratación y compartir tipos entre front y back.

| Capa | Tecnología | Por qué |
|------|------------|---------|
| Apps móviles (paciente/médico) | React Native (Expo) | Reutiliza el equipo y los componentes React del front actual; una base para iOS y Android |
| Panel de dirección | React + Vite | Ya iniciado en el prototipo |
| Lenguaje backend | TypeScript (Node.js 22 LTS) | Mismo lenguaje que el front; tipado de extremo a extremo |
| Framework API | Fastify | Ligero, rápido, buen tipado y ecosistema de plugins |
| Base de datos | PostgreSQL 16 (gestionado en la UE) | Relacional, maduro, cifrado en reposo, soporte de auditoría |
| Acceso a datos | Prisma o `pg` | Migraciones versionadas y tipos generados |
| Caché y tiempo real | Redis | Sesiones, rate limiting distribuido, colas de matching |
| Tiempo real (cola/matching) | WebSocket (Socket.IO) sobre Redis pub/sub | Estado “médico disponible / paciente en cola” en vivo |
| Videoconsulta | Proveedor WebRTC sanitario (p. ej. Twilio Video, Daily o Vonage) con acuerdo de encargado de tratamiento | No reinventar SFU; delegar cumplimiento de transporte de vídeo |
| Almacenamiento de ficheros | S3 (UE) con cifrado SSE-KMS | Fotos del paciente, informes, recetas |
| Autenticación | JWT access + refresh rotatorio (módulo construido) | Stateless en la API; revocación por familia de tokens |
| Infra | Contenedores en la UE (p. ej. AWS eu-west / OVHcloud) detrás de API gateway + WAF | Residencia de datos y defensa perimetral |
| Observabilidad | Logs estructurados + APM (sin PHI en los logs) | Operar el servicio sin exponer datos sensibles |

Alternativa conservadora: si el equipo prefiere máxima estandarización,
Express en lugar de Fastify y NestJS si se quiere una estructura modular más
opinionada a medida que crecen los módulos.

---

## 3. Vista de capas

```
   App paciente        App médico         Panel dirección
  (React Native)      (React Native)        (React/Vite)
        \                  |                    /
         \                 |                   /
                  API Gateway + WAF (TLS, UE)
                            |
                  ┌─────────┴──────────┐
                  │   API Fastify       │   ← autenticación, autorización por rol
                  │  (TypeScript)       │
                  └─────────┬──────────┘
        ┌──────────┬────────┼─────────┬──────────────┐
     Auth      Pacientes  Médicos  Consultas      Facturación
     (✓)      (perfil ✓)  (cola)  (vídeo, notas)  (cobros)
        └──────────┴────────┼─────────┴──────────────┘
                  ┌─────────┴──────────┐
            PostgreSQL (UE)   Redis   S3 (UE, cifrado)
```

El módulo entregado cubre **Auth** y la parte de **perfil clínico** de
Pacientes. El resto son los siguientes módulos del roadmap.

---

## 4. Seguridad y cumplimiento

- **Contraseñas**: KDF con sal por usuario. El módulo usa `scrypt` de la
  librería estándar; argon2id es una mejora directa si se desea.
- **Datos de salud (PHI) cifrados en reposo**: el historial se cifra con
  AES-256-GCM a nivel de aplicación antes de persistir. En la base de datos
  solo hay texto cifrado; ni un volcado de la BBDD expone el historial. Las
  claves se gestionan con un KMS en producción.
- **Tokens**: access JWT corto (15 min); refresh de 30 días con rotación y
  guardado como hash. El reuso de un refresh consumido se interpreta como robo
  y revoca toda la familia de sesiones.
- **Transporte**: TLS en todo; HSTS; cabeceras de seguridad (helmet).
- **Superficie**: rate limiting global y reforzado en login/registro;
  validación estricta de entrada (zod); errores que no revelan si un email
  existe.
- **Consentimiento granular** (separación de finalidades):
  - Asistencial — obligatorio para prestar la consulta (base jurídica art. 9).
  - Términos y privacidad — obligatorio.
  - Recomendaciones/servicios personalizados — **opcional e independiente**.
    El uso comercial del historial solo es lícito con este opt-in, y debe poder
    retirarse.
- **Derechos RGPD desde el día uno**: acceso/portabilidad (exportar datos) y
  supresión (borrado en cascada de cuenta, perfil y tokens). Conviene añadir un
  registro de auditoría de accesos al historial por parte de los médicos.
- **Aspectos sanitarios a validar con asesoría**: verificación de colegiación
  del médico, requisitos de la receta electrónica privada y conservación
  documental de la historia clínica. No bloquean el arranque, pero condicionan
  los módulos de Médicos y Consultas.

---

## 5. Modelo de datos (estado actual)

```
users               (id, email, password_hash, role, email_verified,
                     verify_token/expires, invite_token/expires, created_at)
refresh_tokens      (id=jti, user_id, token_hash, expires_at, revoked, created_at)
patient_profiles    (user_id, data_enc, consent_assist, consent_terms, consent_reco, ...)
doctor_profiles     (user_id, full_name, specialty, license_number, license_status,
                     availability, bio, languages, rating, consultations, last_seen, ...)
consultations       (id, patient_id, doctor_id, specialty, reason_enc, status,
                     room_id, notes_enc, summary_enc, price_cents, timestamps...)
access_log          (id, consultation_id, actor_id, subject_id, action, at)
```

`role` distingue paciente, médico y administrador. `patient_profiles.data_enc`
contiene el cuestionario médico cifrado; los consentimientos van en claro por
ser auditables. `doctor_profiles.license_status` (pending/verified/rejected)
gobierna si el médico puede ponerse disponible. Crecimiento previsto:
`consultations`, `prescriptions`, `payments`, `audit_log`.

---

## 6. Autenticación — flujo

1. **Registro** → cuenta sin verificar + token de verificación (email en
   producción).
2. **Verificación** del correo.
3. **Login** → `accessToken` (15 min) + `refreshToken` (30 días).
4. La app llama a la API con `Authorization: Bearer <access>`.
5. Al caducar el access, **refresh** rota ambos tokens.
6. **Logout** revoca el refresh. La supresión RGPD revoca toda la familia.

Próximo paso recomendado en auth: 2FA para médicos (acceden a datos de
terceros) y, más adelante, inicio de sesión con identidad verificada.

---

## 7. Roadmap de módulos

1. **Auth + perfil del paciente** — construido.
2. **Médicos** — construido: alta por invitación, **onboarding completo**
   (titulación, especialidad, seguro RC y datos bancarios con IBAN cifrado, más
   subida de documentos), verificación de colegiación, disponibilidad, **2FA
   (TOTP)** y **liquidaciones** por fechas con comisión de plataforma.
3. **Consultas** — construido: cola y matching en tiempo real (SSE sobre bus de
   eventos; Redis pub/sub + WebSocket en producción), asignación atómica,
   videoconsulta (sala; integrar proveedor WebRTC), notas e informe cifrados, y
   auditoría de accesos al historial.
4. **Receta electrónica** — construido: emisión por el médico, medicamentos
   cifrados, sello de integridad y documento para el paciente. Pendiente externo:
   firma cualificada y dispensación vía plataforma homologada (REMPe/CGCOF).
5. **Facturación y pagos** — construido: precio por especialidad, la consulta no
   entra en cola hasta pagar, recibos y proveedor abstracto (demo o Stripe real
   por webhook). Pendiente externo: cuenta de Stripe y claves.
6. **Panel de dirección** — construido: métricas reales de consultas, ingresos,
   especialidades, equipo médico, recetas y cola, por periodo (hoy/7d/30d).
7. **Auditoría y cumplimiento**: ampliar el registro de accesos a exportaciones
   y retención (base ya iniciada en `access_log`).

---

## 8. Qué hay construido y probado

El módulo de autenticación está implementado y verificado de extremo a extremo:
registro, verificación, login, rechazo de credenciales incorrectas, guardado
del cuestionario con cifrado en reposo, lectura descifrada para el titular,
rotación de refresh con detección de reuso, y supresión RGPD. Tipado de
TypeScript sin errores. Ver `README.md` para arrancarlo.

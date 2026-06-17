// Plantilla del email de verificación. CSS en línea (requisito de los clientes
// de correo). Devuelve asunto, versión HTML y versión texto plano.
const BRAND = "#0C6B5A", DEEP = "#063F35", INK = "#0F1B19", INK2 = "#56655F", LINE = "#E1E7E5";

export function verificationEmail(name: string, link: string, ttlHours: number) {
  const hello = name ? `Hola, ${name}` : "Te damos la bienvenida";
  const subject = "Verifica tu correo en Pulso";

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#EDF1F0;font-family:Arial,Helvetica,sans-serif;color:${INK};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EDF1F0;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border:1px solid ${LINE};border-radius:18px;overflow:hidden;">
        <tr><td style="background:${DEEP};padding:22px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;padding-right:10px;">
              <div style="width:30px;height:30px;border-radius:50%;border:1.5px solid rgba(255,255,255,.5);text-align:center;line-height:30px;color:#fff;font-weight:bold;">P</div>
            </td>
            <td style="vertical-align:middle;color:#fff;font-size:20px;font-weight:bold;letter-spacing:-0.5px;">Pulso</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:30px 28px 8px;">
          <h1 style="margin:0 0 8px;font-size:21px;color:${INK};">${hello}</h1>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:${INK2};">
            Confirma tu correo para activar tu cuenta y empezar a usar Pulso. El enlace caduca en ${ttlHours} horas.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px;"><tr>
            <td style="border-radius:13px;background:${BRAND};">
              <a href="${link}" style="display:inline-block;padding:14px 26px;font-size:15px;font-weight:bold;color:#fff;text-decoration:none;border-radius:13px;">Verificar mi correo</a>
            </td>
          </tr></table>
          <p style="margin:0 0 6px;font-size:12px;color:${INK2};">Si el botón no funciona, copia este enlace en tu navegador:</p>
          <p style="margin:0 0 22px;font-size:12px;word-break:break-all;"><a href="${link}" style="color:${BRAND};">${link}</a></p>
          <p style="margin:0;font-size:12px;line-height:1.5;color:${INK2};">Si no has creado una cuenta en Pulso, ignora este mensaje.</p>
        </td></tr>
        <tr><td style="padding:18px 28px 26px;border-top:1px solid ${LINE};">
          <p style="margin:0;font-size:11px;color:#8A9893;line-height:1.5;">Pulso · El médico, ahora. Este es un correo automático, no respondas a esta dirección.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = `${hello}

Confirma tu correo para activar tu cuenta en Pulso. El enlace caduca en ${ttlHours} horas:
${link}

Si no has creado una cuenta en Pulso, ignora este mensaje.
— Pulso`;

  return { subject, html, text };
}

export function invitationEmail(name: string, specialty: string, link: string, ttlHours: number) {
  const hello = name ? `Hola, ${name}` : "Te damos la bienvenida";
  const subject = "Únete a Pulso como profesional";

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#EDF1F0;font-family:Arial,Helvetica,sans-serif;color:${INK};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EDF1F0;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border:1px solid ${LINE};border-radius:18px;overflow:hidden;">
        <tr><td style="background:${DEEP};padding:22px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;padding-right:10px;">
              <div style="width:30px;height:30px;border-radius:50%;border:1.5px solid rgba(255,255,255,.5);text-align:center;line-height:30px;color:#fff;font-weight:bold;">P</div>
            </td>
            <td style="vertical-align:middle;color:#fff;font-size:20px;font-weight:bold;letter-spacing:-0.5px;">Pulso</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:30px 28px 8px;">
          <h1 style="margin:0 0 8px;font-size:21px;color:${INK};">${hello}</h1>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:${INK2};">
            Te invitamos a formar parte del equipo médico de Pulso${specialty ? ` en <b>${specialty}</b>` : ""}. Crea tu contraseña para activar tu cuenta. El enlace caduca en ${ttlHours} horas.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px;"><tr>
            <td style="border-radius:13px;background:${BRAND};">
              <a href="${link}" style="display:inline-block;padding:14px 26px;font-size:15px;font-weight:bold;color:#fff;text-decoration:none;border-radius:13px;">Activar mi cuenta</a>
            </td>
          </tr></table>
          <p style="margin:0 0 6px;font-size:12px;color:${INK2};">Si el botón no funciona, copia este enlace:</p>
          <p style="margin:0 0 22px;font-size:12px;word-break:break-all;"><a href="${link}" style="color:${BRAND};">${link}</a></p>
          <p style="margin:0;font-size:12px;line-height:1.5;color:${INK2};">Tras activarla, el equipo verificará tu colegiación antes de que puedas atender.</p>
        </td></tr>
        <tr><td style="padding:18px 28px 26px;border-top:1px solid ${LINE};">
          <p style="margin:0;font-size:11px;color:#8A9893;line-height:1.5;">Pulso · El médico, ahora. Este es un correo automático, no respondas a esta dirección.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = `${hello}

Te invitamos al equipo médico de Pulso${specialty ? ` en ${specialty}` : ""}. Crea tu contraseña para activar tu cuenta (el enlace caduca en ${ttlHours} horas):
${link}

Tras activarla, verificaremos tu colegiación antes de que puedas atender.
— Pulso`;

  return { subject, html, text };
}

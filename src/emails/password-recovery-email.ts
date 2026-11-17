/**
 * E-mail de recuperação de senha do Passaporte Burguer.
 * HTML tabular com CSS 100% inline (Gmail, Outlook e Apple Mail) + versão em texto puro.
 */

export const PASSWORD_RECOVERY_SUBJECT = "✈️ Seu código de embarque para redefinir a senha — Passaporte Burguer";

const NAVY = "#071329";
const AMBER = "#F59E0B";
const BG = "#F8FAFC";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,'Courier New',monospace";

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

export function buildPasswordRecoveryEmail(input: { name: string; code: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const firstName = firstNameOf(input.name);
  const greeting = firstName ? `Olá, ${firstName}!` : "Olá!";
  const code = input.code.replace(/\D/g, "").slice(0, 6);
  const intro = "Recebemos uma solicitação para redefinir a senha da sua conta no Passaporte Burguer.";
  const security =
    "Este código expira em 15 minutos e pode ser usado apenas uma vez. Se você não solicitou a troca de senha, ignore este e-mail — sua conta continua protegida.";
  const slogan = "Não precisa de visto, só de vontade de saborear!";
  const address = "Passaporte Burguer • Av. São Paulo, 123 - Zona 07, Maringá - PR";

  const html = `<!DOCTYPE html>
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(PASSWORD_RECOVERY_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background-color:${BG};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BG};">Seu código de recuperação: ${code}. Expira em 15 minutos.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BG};">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;">

        <!-- Header -->
        <tr>
          <td align="center" bgcolor="${NAVY}" style="background-color:${NAVY};border-radius:16px 16px 0 0;padding:28px 24px 24px 24px;">
            <div style="font-family:${FONT};font-size:24px;line-height:28px;font-weight:800;letter-spacing:2px;color:#FFFFFF;">PASSAPORTE <span style="color:${AMBER};">BURGUER</span></div>
            <div style="font-family:${MONO};font-size:11px;line-height:16px;letter-spacing:1.5px;color:#94A3B8;margin-top:8px;">CARTÃO DE ACESSO • RECUPERAÇÃO DE SENHA</div>
          </td>
        </tr>

        <!-- Corpo -->
        <tr>
          <td bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:32px 28px 8px 28px;border-left:1px solid #E2E8F0;border-right:1px solid #E2E8F0;">
            <p style="margin:0 0 12px 0;font-family:${FONT};font-size:20px;line-height:26px;font-weight:700;color:${NAVY};">${escapeHtml(greeting)}</p>
            <p style="margin:0 0 24px 0;font-family:${FONT};font-size:15px;line-height:24px;color:#334155;">${intro}</p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" bgcolor="${BG}" style="background-color:${BG};border:2px dashed #CBD5E1;border-radius:12px;padding:20px;">
                  <div style="font-family:${MONO};font-size:11px;line-height:16px;letter-spacing:1.5px;color:#64748B;margin-bottom:8px;">SEU CÓDIGO DE EMBARQUE</div>
                  <div style="font-family:${MONO};font-size:32px;line-height:40px;font-weight:800;letter-spacing:8px;color:${NAVY};padding-left:8px;">${code}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Linha estilo ticket -->
        <tr>
          <td bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:24px 0 0 0;border-left:1px solid #E2E8F0;border-right:1px solid #E2E8F0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="14" bgcolor="${BG}" style="background-color:${BG};border-radius:0 14px 14px 0;height:28px;line-height:28px;font-size:0;">&nbsp;</td>
                <td style="padding:0 8px;"><div style="border-top:2px dotted #CBD5E1;height:0;line-height:0;font-size:0;">&nbsp;</div></td>
                <td width="14" bgcolor="${BG}" style="background-color:${BG};border-radius:14px 0 0 14px;height:28px;line-height:28px;font-size:0;">&nbsp;</td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Nota de segurança -->
        <tr>
          <td bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:8px 28px 32px 28px;border-left:1px solid #E2E8F0;border-right:1px solid #E2E8F0;border-bottom:1px solid #E2E8F0;box-shadow:0 4px 12px rgba(7,19,41,0.06);">
            <p style="margin:0;font-family:${FONT};font-size:13px;line-height:20px;color:#64748B;">${security}</p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td align="center" bgcolor="${NAVY}" style="background-color:${NAVY};border-radius:0 0 16px 16px;padding:24px;">
            <div style="font-family:${FONT};font-size:14px;line-height:20px;font-weight:700;color:${AMBER};">${slogan}</div>
            <div style="font-family:${FONT};font-size:12px;line-height:18px;color:#94A3B8;margin-top:10px;">${address}<br>&copy; ${new Date().getFullYear()} Passaporte Burguer. Todos os direitos reservados.</div>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = [
    "PASSAPORTE BURGUER",
    "CARTÃO DE ACESSO • RECUPERAÇÃO DE SENHA",
    "",
    greeting,
    "",
    intro,
    "",
    `Seu código de embarque: ${code}`,
    "",
    "- - - - - - - - - - - - - - - - - - - -",
    security,
    "",
    slogan,
    address,
    `© ${new Date().getFullYear()} Passaporte Burguer. Todos os direitos reservados.`,
  ].join("\n");

  return { subject: PASSWORD_RECOVERY_SUBJECT, html, text };
}

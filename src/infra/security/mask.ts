/** Mascaramento de dados pessoais para logs (LGPD): nunca registre telefone/e-mail completos. */

/** "5543996142131" -> "55*********31" (mantém só o DDI e os 2 últimos dígitos). */
export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length <= 4) return "****";
  return `${d.slice(0, 2)}${"*".repeat(d.length - 4)}${d.slice(-2)}`;
}

/** "joao@gmail.com" -> "j***@gmail.com". */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "***";
  return `${user[0]}***@${domain}`;
}

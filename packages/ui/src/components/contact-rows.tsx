/**
 * A tel: link for a phone number, or undefined when the text is more than a number (for example
 * "06 12 34 56 78 (na 18 uur)"): a wrong number is worse than no link.
 */
export function telHref(phone: string): string | undefined {
  const digits = phone.replace(/[\s\-.()]/g, "");
  return /^\+?\d+$/.test(digits) ? `tel:${digits}` : undefined;
}

/** A mailto: link; the address is encoded, except "@" and "+", which are valid there. */
export function mailHref(email: string): string {
  return `mailto:${encodeURIComponent(email).replace(/%40/g, "@").replace(/%2B/g, "+")}`;
}

const linkClass = "underline underline-offset-4 break-all";

/** One labeled row of a detail screen. */
export function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-base text-muted-foreground">{label}</dt>
      <dd className="text-lg">{children}</dd>
    </div>
  );
}

/**
 * Email address and phone number as links. Without an email address the person has no contact
 * details for this viewer (or was deleted), so no rows at all.
 */
export function ContactRows({ email, phone }: { email?: string; phone?: string | null }) {
  if (email === undefined) return null;
  return (
    <>
      <DetailRow label="E-mailadres">
        <a href={mailHref(email)} className={linkClass}>
          {email}
        </a>
      </DetailRow>
      {phone ? (
        <DetailRow label="Telefoonnummer">
          {telHref(phone) ? (
            <a href={telHref(phone)} className={linkClass}>
              {phone}
            </a>
          ) : (
            phone
          )}
        </DetailRow>
      ) : (
        <DetailRow label="Telefoonnummer">Geen telefoonnummer</DetailRow>
      )}
    </>
  );
}

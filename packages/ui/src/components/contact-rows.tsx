/** The phone number without spaces and dashes, for a tel: link. */
export function telHref(phone: string): string {
  return `tel:${encodeURIComponent(phone.replace(/[^\d+]/g, ""))}`;
}

export function mailHref(email: string): string {
  return `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}`;
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
          <a href={telHref(phone)} className={linkClass}>
            {phone}
          </a>
        </DetailRow>
      ) : (
        <DetailRow label="Telefoonnummer">Geen telefoonnummer</DetailRow>
      )}
    </>
  );
}

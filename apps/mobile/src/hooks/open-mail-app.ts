/** The link that opens the phone's default mail app, or `null` where there is none. */
export function mailAppUrl(userAgent: string): string | null {
  if (/iPhone|iPad|iPod/.test(userAgent)) return "message://";
  if (/Android/.test(userAgent)) {
    return "intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.APP_EMAIL;end";
  }
  return null;
}

/** Opens the mail app. Does nothing where `mailAppUrl` is `null`. */
export function openMailApp(): void {
  const url = mailAppUrl(navigator.userAgent);
  if (url !== null) window.location.href = url;
}

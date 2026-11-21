const formatter = new Intl.DateTimeFormat("nl-NL", {
  timeZone: "Europe/Amsterdam",
  dateStyle: "short",
  timeStyle: "medium",
});

/** Shows a moment the way users read it: Dutch format, Amsterdam time. */
export function formatDateTime(value: Date | string): string {
  return formatter.format(typeof value === "string" ? new Date(value) : value);
}

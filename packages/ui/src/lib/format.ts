const dateTimeFormatter = new Intl.DateTimeFormat("nl-NL", {
  timeZone: "Europe/Amsterdam",
  dateStyle: "short",
  timeStyle: "medium",
});

const dateFormatter = new Intl.DateTimeFormat("nl-NL", {
  timeZone: "Europe/Amsterdam",
  dateStyle: "long",
});

/** Shows a moment the way users read it: Dutch format, Amsterdam time. */
export function formatDateTime(value: Date | string): string {
  return dateTimeFormatter.format(typeof value === "string" ? new Date(value) : value);
}

/** Shows the Amsterdam day of a moment, like "10 januari 2027". */
export function formatDate(value: Date | string): string {
  return dateFormatter.format(typeof value === "string" ? new Date(value) : value);
}

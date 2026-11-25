const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether the text is a UUID in any case; the API accepts both cases too. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * The name as a heading or row label. A person who never logged in (`hasLoggedIn` false) has no
 * name to show yet; a person who did, without a name, gets a plain placeholder.
 */
export function displayName(name: string, hasLoggedIn?: boolean): string {
  if (hasLoggedIn === false) return "(nog niet ingelogd)";
  return name.trim() === "" ? "(nog geen naam)" : name;
}

/** The name inside a sentence, such as "{naam} krijgt hierover een mail." */
export function nameInSentence(name: string): string {
  return name.trim() === "" ? "Deze persoon" : name;
}

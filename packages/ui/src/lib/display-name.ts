/** The name as a heading or row label; a person without a name gets a plain placeholder. */
export function displayName(name: string): string {
  return name.trim() === "" ? "Naam niet ingevuld" : name;
}

/** The name inside a sentence, such as "{naam} krijgt hierover een mail." */
export function nameInSentence(name: string): string {
  return name.trim() === "" ? "Deze persoon" : name;
}

/** A person who has not given a name yet still needs something to tap on. */
export function displayName(name: string): string {
  return name.trim() === "" ? "Zonder naam" : name;
}

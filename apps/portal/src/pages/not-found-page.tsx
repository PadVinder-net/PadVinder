import { Link } from "react-router";

/** For an address that does not exist, and for a page this user may not see. */
export function NotFoundPage() {
  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="mb-2 text-2xl font-bold">Deze pagina bestaat niet</h1>
      <p>Of je mag haar niet zien.</p>
      <Link to="/" className="mt-4 inline-block underline">
        Terug naar het begin
      </Link>
    </main>
  );
}

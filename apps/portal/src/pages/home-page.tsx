import { Link } from "react-router";

export function HomePage() {
  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="mb-4 text-2xl font-bold">PadVinder</h1>
      <Link to="/system" className="underline">
        Systeemstatus
      </Link>
    </main>
  );
}

import { useLogOut } from "@padvinder/api-client";
import { Button } from "@padvinder/ui";
import { Link } from "react-router";

export function HomePage() {
  const { logOut, failed } = useLogOut();
  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="mb-4 text-2xl font-bold">PadVinder</h1>
      <Link to="/system" className="underline">
        Systeemstatus
      </Link>
      {failed ? (
        <p role="alert" className="mt-6 text-base text-destructive">
          Uitloggen lukt nu niet. Controleer je verbinding en probeer het opnieuw.
        </p>
      ) : null}
      <Button variant="outline" className="mt-6 block" onClick={() => void logOut()}>
        Log uit
      </Button>
    </main>
  );
}

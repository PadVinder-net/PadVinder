import { useLogOut, useMe } from "@padvinder/api-client";
import { Button, logOutFailedMessage } from "@padvinder/ui";
import { Link } from "react-router";

export function HomePage() {
  const me = useMe();
  const { logOut, failed } = useLogOut();
  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="mb-4 text-2xl font-bold">PadVinder</h1>
      {me.data?.user.isPlatformAdmin ? (
        <Link to="/system" className="underline">
          Systeemstatus
        </Link>
      ) : (
        <p>Hier is nog niets te doen. Het beheer komt binnenkort.</p>
      )}
      {failed ? (
        <p role="alert" className="mt-6 text-base text-destructive">
          {logOutFailedMessage}
        </p>
      ) : null}
      <Button variant="outline" className="mt-6 block" onClick={() => void logOut()}>
        Log uit
      </Button>
    </main>
  );
}

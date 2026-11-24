import { useLogOut, useMe } from "@padvinder/api-client";
import { Button, logOutFailedMessage } from "@padvinder/ui";
import { APP_BUILD, APP_VERSION } from "../app-version";
import { MoreMenu } from "./more/more-menu";

/** The Meer tab: the menu, then Log uit and the app version. */
export function MoreScreen() {
  const me = useMe();
  const { logOut, failed: logOutFailed } = useLogOut();

  return (
    <section className="p-4">
      <h1 className="mb-4 text-2xl font-bold">Meer</h1>
      {me.data ? <MoreMenu me={me.data} /> : null}
      {logOutFailed ? (
        <p role="alert" className="mt-6 text-base text-destructive">
          {logOutFailedMessage}
        </p>
      ) : null}
      <Button
        size="lg"
        variant="outline"
        className="mt-6 h-14 w-full text-lg"
        onClick={() => void logOut()}
      >
        Log uit
      </Button>
      <p className="text-muted-foreground mt-4 text-sm">
        App-versie {APP_VERSION} ({APP_BUILD})
      </p>
    </section>
  );
}

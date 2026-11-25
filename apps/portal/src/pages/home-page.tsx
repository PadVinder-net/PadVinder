import { useMe } from "@padvinder/api-client";
import { Navigate } from "react-router";
import { managesSomething, navigationFor } from "../layout/navigation";

/** Sends someone with navigation items to the first one; tells everyone else what the portal is. */
export function HomePage() {
  const me = useMe().data;
  if (!me) return null;
  const [first] = navigationFor(me);
  if (first) return <Navigate replace to={first.to} />;
  return (
    <main className="mx-auto max-w-2xl p-4">
      {managesSomething(me) ? (
        <p>Hier is nog niets te doen. Het beheer komt binnenkort.</p>
      ) : (
        <>
          <p>Het portaal is voor coördinatoren en beheerders. Tellen doe je in de app.</p>
          {/* A plain link: the app is another page load, outside this router. */}
          <a href="/app/" className="mt-4 inline-block underline">
            Open de app
          </a>
        </>
      )}
    </main>
  );
}

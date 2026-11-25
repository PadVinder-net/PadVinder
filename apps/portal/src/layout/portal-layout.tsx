import { useAccessLiveUpdates, useLogOut, useMe } from "@padvinder/api-client";
import { Button, logOutFailedMessage, Toaster } from "@padvinder/ui";
import { NavLink, Outlet } from "react-router";
import { navigationFor } from "./navigation";

/**
 * The frame around every portal page, inside the auth gate: a header with the navigation for this
 * user's role, their name and "Log uit", and the page below. It keeps me up to date from the live
 * stream, so the navigation and the pages follow a change of rights without a reload.
 */
export function PortalLayout() {
  const me = useMe().data;
  const { logOut, failed } = useLogOut();
  useAccessLiveUpdates();
  if (!me) return null;
  const items = navigationFor(me);
  return (
    <>
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 p-4">
          <span className="text-lg font-bold">PadVinder</span>
          {items.length > 0 ? (
            <nav aria-label="Beheer">
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      className={({ isActive }) =>
                        isActive
                          ? "font-bold underline decoration-2 underline-offset-4"
                          : "hover:underline"
                      }
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
            <span>{me.user.name}</span>
            <Button variant="outline" onClick={() => void logOut()}>
              Log uit
            </Button>
          </div>
        </div>
        {failed ? (
          <p role="alert" className="mx-auto max-w-5xl px-4 pb-4 text-base text-destructive">
            {logOutFailedMessage}
          </p>
        ) : null}
      </header>
      <Outlet />
      <Toaster />
    </>
  );
}

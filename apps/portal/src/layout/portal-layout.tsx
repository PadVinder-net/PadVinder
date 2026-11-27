import {
  useAccessLiveUpdates,
  useLogOut,
  useManagedWorkingGroups,
  useMe,
} from "@padvinder/api-client";
import { Button, logOutFailedMessage, Toaster } from "@padvinder/ui";
import { Link, NavLink, Outlet } from "react-router";
import { PasskeyConfirmationHost } from "../auth/passkey-confirmation-host";
import { navigationFor, type NavItem } from "./navigation";
import { ReportProblemButton } from "./report-problem";

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
                    {item.to === requestsPath ? (
                      <RequestsLink item={item} />
                    ) : (
                      <NavItemLink item={item} />
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
            <ReportProblemButton me={me} />
            <Link to="/profile" aria-label="Profiel" className="underline-offset-4 hover:underline">
              {me.user.name}
            </Link>
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
      <PasskeyConfirmationHost />
    </>
  );
}

const requestsPath = "/membership-requests";

function NavItemLink({ item, openCount = 0 }: { item: NavItem; openCount?: number }) {
  return (
    <NavLink
      to={item.to}
      aria-label={openCount > 0 ? `${item.label}, ${openCount} open` : undefined}
      className={({ isActive }) =>
        isActive ? "font-bold underline decoration-2 underline-offset-4" : "hover:underline"
      }
    >
      {item.label}
      {openCount > 0 ? (
        <span className="ml-1.5 inline-block min-w-6 rounded-full bg-primary px-1.5 text-center text-sm font-bold text-primary-foreground no-underline">
          {openCount}
        </span>
      ) : null}
    </NavLink>
  );
}

/**
 * "Aanmeldingen" with the number of open requests: the sum over the working groups the user
 * manages. Only rendered for someone who manages something, so a volunteer never asks for the list.
 */
function RequestsLink({ item }: { item: NavItem }) {
  const workingGroups = useManagedWorkingGroups({ background: true }).data?.workingGroups ?? [];
  const openCount = workingGroups.reduce((sum, group) => sum + group.pendingRequestCount, 0);
  return <NavItemLink item={item} openCount={openCount} />;
}

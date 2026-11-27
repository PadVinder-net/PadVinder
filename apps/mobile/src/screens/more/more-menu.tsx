import { memberListWorkingGroups, type MeResponse } from "@padvinder/api-client";
import { Badge } from "@padvinder/ui";
import { Link } from "react-router";
import { useRequestLists, useWorkingGroupDirectory } from "./working-group-lists";

const itemClass =
  "flex min-h-14 w-full items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3 text-lg font-medium";

/**
 * The items of the Meer tab. An item is hidden when it would be empty for this user; that is for
 * convenience only, the API decides what a screen shows.
 */
export function MoreMenu({ me }: { me: MeResponse }) {
  const directory = useWorkingGroupDirectory();
  const requests = useRequestLists(me, { background: true });
  const reviews = requests.groups.length + requests.hiddenGroups.length > 0;
  const hasMembers =
    directory.data !== undefined &&
    memberListWorkingGroups(me, directory.data.workingGroups).length > 0;
  const open = requests.groups.reduce((sum, group) => sum + group.requests.length, 0);

  return (
    <nav aria-label="Meer">
      <ul className="flex flex-col gap-2">
        <li>
          <Link to="/more/profile" className={itemClass}>
            Profiel
          </Link>
        </li>
        {reviews ? (
          <li>
            <Link
              to="/more/membership-requests"
              className={itemClass}
              aria-label={open > 0 ? `Aanmeldingen, ${open} open` : undefined}
            >
              Aanmeldingen
              {open > 0 ? <Badge className="px-3 text-base">{open}</Badge> : null}
            </Link>
          </li>
        ) : null}
        {hasMembers ? (
          <li>
            <Link to="/more/members" className={itemClass}>
              Leden
            </Link>
          </li>
        ) : null}
        {me.user.isPlatformAdmin ? (
          <li>
            <Link to="/more/system" className={itemClass}>
              Systeemstatus
            </Link>
          </li>
        ) : null}
        <li>
          <Link to="/more/report-problem" className={itemClass}>
            Meld een probleem
          </Link>
        </li>
      </ul>
    </nav>
  );
}

import { cn } from "@padvinder/ui";
import { NavLink } from "react-router";

const tabs = [
  { label: "Vanavond", to: "/" },
  { label: "Kaart", to: "/map" },
  { label: "Resultaten", to: "/results" },
  { label: "Meer", to: "/more" },
];

/** Fixed at the bottom, within thumb reach. Each tab is 56 px tall. */
export function TabBar() {
  return (
    <nav
      aria-label="Hoofdmenu"
      className="fixed inset-x-0 bottom-0 border-t bg-background pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="flex">
        {tabs.map((tab) => (
          <li key={tab.to} className="flex-1">
            <NavLink
              to={tab.to}
              end
              className={({ isActive }) =>
                cn(
                  "flex h-14 items-center justify-center border-t-4 text-base",
                  // The current tab is marked by a thick bar and bold text, not by color alone.
                  isActive
                    ? "border-primary font-bold text-foreground"
                    : "border-transparent text-muted-foreground",
                )
              }
            >
              {tab.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

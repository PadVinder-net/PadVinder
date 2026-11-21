import { Outlet } from "react-router";
import { TabBar } from "./components/tab-bar";
import { UpdatePrompt } from "./components/update-prompt";

/** The root route: the current screen above a fixed tab bar. */
export function AppLayout() {
  return (
    <>
      <UpdatePrompt />
      <main className="min-h-dvh pb-[calc(3.5rem+env(safe-area-inset-bottom))]">
        <Outlet />
      </main>
      <TabBar />
    </>
  );
}

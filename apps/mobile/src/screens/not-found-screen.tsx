import { Button } from "@padvinder/ui";
import { Link } from "react-router";

/** For an address without a screen, inside the layout so the tabs stay. Same text as the portal. */
export function NotFoundScreen() {
  return (
    <section className="flex flex-col gap-4 p-4 text-lg">
      <h1 className="text-2xl font-bold">Deze pagina bestaat niet</h1>
      <p>Of je mag haar niet zien.</p>
      <Button asChild size="lg" className="h-14 w-full text-lg">
        <Link to="/">Terug naar het begin</Link>
      </Button>
    </section>
  );
}

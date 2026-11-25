import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export type RowMenuItem = { label: string; onSelect(): void; destructive?: boolean };

export type RowMenuProps = {
  /** The accessible name of the button, for example "Acties voor Noord". */
  label: string;
  items: RowMenuItem[];
  /** Only for the story that shows the open menu. */
  defaultOpen?: boolean;
};

/** A three-dot button that opens the actions of one table row. Without items it renders nothing. */
export function RowMenu({ label, items, defaultOpen }: RowMenuProps) {
  if (items.length === 0) return null;
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger
        aria-label={label}
        className="inline-flex size-11 items-center justify-center rounded-md hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="currentColor">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            variant={item.destructive ? "destructive" : "default"}
            onSelect={item.onSelect}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

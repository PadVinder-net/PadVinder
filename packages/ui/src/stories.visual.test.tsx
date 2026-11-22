import { composeStories, type composeStory, type Meta } from "@storybook/react-vite";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";

type StoryModule = Parameters<typeof composeStories>[0] & { default: Meta };
type ComposedStory = ReturnType<typeof composeStory>;

// Every story file in the package, so a new story is covered with no extra code.
const storyModules = import.meta.glob<StoryModule>("./**/*.stories.tsx", { eager: true });

function kebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

for (const [path, storyModule] of Object.entries(storyModules)) {
  const title = storyModule.default.title;
  if (!title) throw new Error(`${path} has no title in its default export.`);

  const stories = Object.entries(composeStories(storyModule)) as [string, ComposedStory][];
  for (const [exportName, Story] of stories) {
    test(`${title} ${Story.storyName}`, async () => {
      const screen = await render(<Story />);
      await document.fonts.ready;
      await expect
        .element(screen.locator)
        .toMatchScreenshot(`${kebabCase(title)}-${kebabCase(exportName)}`);
    });
  }
}

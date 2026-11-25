import type { Meta, StoryObj } from "@storybook/react-vite";
import { WideButton, inputClass, labelClass } from "./login/form-parts";
import { Modal } from "./modal";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const meta = {
  title: "Modal",
  component: Modal,
  args: {
    open: true,
    title: "Soort wijzigen",
    onClose: () => {},
    children: null,
  },
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="h-[800px] max-w-[390px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Modal>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Open: Story = {
  args: {
    children: (
      <form className="flex flex-col gap-4 text-lg" onSubmit={(event) => event.preventDefault()}>
        <div className="flex flex-col gap-2">
          <Label htmlFor="story-dutch-name" className={labelClass}>
            Nederlandse naam
          </Label>
          <Input id="story-dutch-name" defaultValue="gewone pad" className={inputClass} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="story-scientific-name" className={labelClass}>
            Wetenschappelijke naam
          </Label>
          <Input id="story-scientific-name" defaultValue="Bufo bufo" className={inputClass} />
        </div>
        <WideButton type="submit">Bewaar</WideButton>
      </form>
    ),
  },
};

export const LongContent: Story = {
  args: {
    title: "Uitleg",
    children: (
      <div className="flex flex-col gap-4 text-lg">
        {Array.from({ length: 12 }, (_, index) => (
          <p key={index}>
            Alinea {index + 1}. Deze tekst is lang, zodat je in het venster moet scrollen om alles
            te lezen. De titel en het kruisje blijven bovenaan staan.
          </p>
        ))}
      </div>
    ),
  },
};

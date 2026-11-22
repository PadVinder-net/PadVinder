import { setProjectAnnotations } from "@storybook/react-vite";
import * as preview from "./preview";

// Gives composed stories the same CSS, decorators and parameters as in Storybook.
setProjectAnnotations(preview);

import "@testing-library/jest-dom/vitest";
import { FakeEventSource, installFetchProxy } from "@padvinder/api-client/testing";
import { dismissAllToasts } from "@padvinder/ui";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

installFetchProxy();
afterEach(() => {
  cleanup();
  // Sonner would show this test's toasts again in the next test's Toaster.
  dismissAllToasts();
  FakeEventSource.instances = [];
});

// jsdom has no EventSource; the layout opens the live stream. Tests reach the streams through
// `FakeEventSource.instances`.
globalThis.EventSource ??= FakeEventSource as unknown as typeof EventSource;

// jsdom has no ResizeObserver; Radix's checkbox (in the species form) needs one.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

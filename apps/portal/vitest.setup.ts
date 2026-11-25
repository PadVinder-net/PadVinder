import "@testing-library/jest-dom/vitest";
import { FakeEventSource, installFetchProxy } from "@padvinder/api-client/testing";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

installFetchProxy();
afterEach(() => {
  cleanup();
  FakeEventSource.instances = [];
});

// jsdom has no EventSource; the layout opens the live stream. Tests reach the streams through
// `FakeEventSource.instances`.
globalThis.EventSource ??= FakeEventSource as unknown as typeof EventSource;

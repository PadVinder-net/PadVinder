import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { installFetchProxy } from "@padvinder/api-client/testing";

installFetchProxy();
afterEach(cleanup);

// jsdom has no EventSource; the gate opens the live stream, which these tests do not use.
if (typeof globalThis.EventSource === "undefined") {
  globalThis.EventSource = class {
    static CLOSED = 2;
    readyState = 0;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    addEventListener() {}
    close() {}
  } as unknown as typeof EventSource;
}

// jsdom has no ResizeObserver; Radix's checkbox (in Meld een probleem) needs one.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

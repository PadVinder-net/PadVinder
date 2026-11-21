import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { installFetchProxy } from "@padvinder/api-client/testing";

installFetchProxy();
afterEach(cleanup);

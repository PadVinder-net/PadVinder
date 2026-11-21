import "@testing-library/jest-dom/vitest";
import { installFetchProxy } from "@padvinder/api-client/testing";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

installFetchProxy();
afterEach(cleanup);

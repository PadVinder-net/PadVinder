import { render, screen } from "@testing-library/react";
import {
  databaseUnreachableFixture,
  healthyFixture,
  workerStaleFixture,
} from "@padvinder/contracts/fixtures";
import { expect, test } from "vitest";
import { HealthStatus } from "./health-status";

test("healthy", () => {
  render(<HealthStatus health={healthyFixture} />);
  expect(screen.getByText("Alles werkt")).toBeVisible();
  expect(screen.getByText("Verbonden")).toBeVisible();
  expect(screen.getByText("0123456")).toBeVisible();
});
test("degraded worker", () => {
  render(<HealthStatus health={workerStaleFixture} />);
  expect(screen.getByText("Er is een storing")).toBeVisible();
});
test("database unreachable", () => {
  render(<HealthStatus health={databaseUnreachableFixture} />);
  expect(screen.getByText("Niet bereikbaar")).toBeVisible();
});
test("no heartbeat yet", () => {
  render(<HealthStatus health={{ ...healthyFixture, worker: { lastHeartbeatAt: null } }} />);
  expect(screen.getByText("Nog geen hartslag")).toBeVisible();
});
test("loading", () => {
  render(<HealthStatus />);
  expect(screen.getByText("Systeemstatus laden…")).toBeVisible();
});
test("load failed", () => {
  render(<HealthStatus loadFailed />);
  expect(screen.getByText(/De server is niet bereikbaar/)).toBeVisible();
});
test("has a heading", () => {
  render(<HealthStatus health={healthyFixture} />);
  expect(screen.getByRole("heading", { name: "Systeemstatus" })).toBeVisible();
});
test("shows the last heartbeat in Amsterdam time", () => {
  render(<HealthStatus health={healthyFixture} />);
  expect(screen.getByText(/^Laatste hartslag: .*20:30/)).toBeVisible();
});
test("PostGIS not installed", () => {
  render(
    <HealthStatus
      health={{
        ...healthyFixture,
        database: { ...healthyFixture.database, postgisVersion: null },
      }}
    />,
  );
  expect(screen.getByText("Niet geïnstalleerd")).toBeVisible();
});

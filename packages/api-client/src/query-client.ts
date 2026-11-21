import { QueryClient } from "@tanstack/react-query";

/** The generated client uses `baseUrl: ""`, so requests go to the same origin as the page. */
export function createQueryClient(): QueryClient {
  return new QueryClient();
}

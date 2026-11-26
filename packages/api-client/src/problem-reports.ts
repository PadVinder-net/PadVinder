import { useMutation } from "@tanstack/react-query";
import { reportProblem, type ProblemReportRequestInput } from "./generated";

/**
 * Sends a problem report ("Meld een probleem"). Resolves on 204; throws the API's error body
 * (`report_not_sent` is 502, `too_many_reports` 429), so the form keeps the text. No retry: the
 * user sends again.
 */
export function useReportProblem() {
  return useMutation({
    mutationFn: async (body: ProblemReportRequestInput): Promise<void> => {
      await reportProblem({ body, throwOnError: true });
    },
  });
}

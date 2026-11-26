import { apiErrorCode, useMe, useReportProblem } from "@padvinder/api-client";
import { apiErrorMessage, ProblemReportForm, problemReportSentMessage } from "@padvinder/ui";
import { useHref, useLocation, useNavigate } from "react-router";
import { APP_VERSION } from "../../app-version";
import { SubScreen, type FlashState } from "./sub-screen";

/** Meer, "Meld een probleem": a message to the makers. A sent report goes back to Meer. */
export function ReportProblemScreen() {
  const me = useMe().data;
  const report = useReportProblem();
  const navigate = useNavigate();
  // The path with the /app/ base, without the query.
  const page = useHref({ pathname: useLocation().pathname });
  if (!me) return null;
  return (
    <SubScreen back="/more">
      <ProblemReportForm
        name={me.user.name}
        email={me.user.email}
        errorText={report.isError ? apiErrorMessage(apiErrorCode(report.error)) : undefined}
        onSubmit={async (input) => {
          await report.mutateAsync({
            ...input,
            page: page.slice(0, 500),
            appVersion: APP_VERSION,
            app: "app",
          });
          void navigate("/more", {
            state: { message: problemReportSentMessage } satisfies FlashState,
          });
        }}
      />
    </SubScreen>
  );
}

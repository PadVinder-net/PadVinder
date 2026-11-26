import { apiErrorCode, useReportProblem, type GetMeResponse } from "@padvinder/api-client";
import {
  apiErrorMessage,
  Button,
  Modal,
  ProblemReportForm,
  problemReportSentMessage,
  problemReportTitle,
  showToast,
} from "@padvinder/ui";
import { useState } from "react";
import { useLocation } from "react-router";

/**
 * "Meld een probleem" in the header bar, next to the name, for everyone who sees the portal: the form in a modal.
 * The modal's content is new on every opening, so the box starts unticked and the text empty.
 */
export function ReportProblemButton({ me }: { me: NonNullable<GetMeResponse> }) {
  const [open, setOpen] = useState(false);
  const report = useReportProblem();
  const page = useLocation().pathname;
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          report.reset();
          setOpen(true);
        }}
      >
        {problemReportTitle}
      </Button>
      <Modal open={open} title={problemReportTitle} onClose={() => setOpen(false)}>
        <ProblemReportForm
          heading={false}
          name={me.user.name}
          email={me.user.email}
          errorText={report.isError ? apiErrorMessage(apiErrorCode(report.error)) : undefined}
          onSubmit={async (input) => {
            await report.mutateAsync({
              ...input,
              page: page.slice(0, 500),
              // The portal has no version of its own: it is identified by its commit.
              appVersion: __GIT_COMMIT__,
              app: "portal",
            });
            setOpen(false);
            showToast(problemReportSentMessage);
          }}
        />
      </Modal>
    </>
  );
}

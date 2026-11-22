import {
  apiErrorCode,
  apiErrorMessage,
  getMembershipRequestOptions,
  useApproveMembershipRequest,
  useRejectMembershipRequest,
} from "@padvinder/api-client";
import { MembershipRequestDetail, nameInSentence } from "@padvinder/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import { LoadError, Loading, SubScreen, type FlashState } from "./sub-screen";

const listPath = "/more/membership-requests";

/**
 * One request, with "Keur goed" and "Wijs af". The target of the link in the coordinator's mail:
 * opened without a login, the gate shows the login screen at this address first.
 */
export function MembershipRequestScreen() {
  const { requestId = "" } = useParams();
  return (
    <SubScreen back={listPath}>
      <Request id={requestId} />
    </SubScreen>
  );
}

function Request({ id }: { id: string }) {
  const navigate = useNavigate();
  const request = useQuery(getMembershipRequestOptions({ path: { id } }));
  const approve = useApproveMembershipRequest();
  const reject = useRejectMembershipRequest();

  if (request.isPending) return <Loading>Aanmelding laden…</Loading>;
  if (request.isError)
    return <LoadError error={request.error} onRetry={() => void request.refetch()} />;

  const backWith = (message: string) =>
    void navigate(listPath, { state: { message } satisfies FlashState });
  // A failed decision (409 already_decided also reloads the request, in the hooks).
  const failed = approve.isError ? approve.error : reject.isError ? reject.error : null;
  const name = nameInSentence(request.data.applicant.name);

  return (
    <MembershipRequestDetail
      request={request.data}
      pending={approve.isPending || reject.isPending}
      error={failed === null ? undefined : apiErrorMessage(apiErrorCode(failed))}
      onApprove={() => {
        reject.reset();
        approve.mutate({ id }, { onSuccess: () => backWith(`${name} is toegelaten.`) });
      }}
      onReject={() => {
        approve.reset();
        reject.mutate({ id }, { onSuccess: () => backWith("De aanmelding is afgewezen.") });
      }}
    />
  );
}

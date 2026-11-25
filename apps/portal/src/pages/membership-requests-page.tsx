import {
  apiErrorCode,
  getMembershipRequest,
  refetchAdministration,
  useApproveMembershipRequest,
  useRejectMembershipRequest,
  useReviewableMembershipRequests,
} from "@padvinder/api-client";
import type { MembershipRequestForReview, WorkingGroupSummary } from "@padvinder/contracts";
import {
  apiErrorMessage,
  displayName,
  MembershipRequestDetail,
  MembershipRequestTable,
  Modal,
  nameInSentence,
  showToast,
} from "@padvinder/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router";
import { RequireManagesSomething } from "../layout/require-manages-something";
import { LoadError } from "./load-error";

const alreadyDecidedMessage = "Deze aanmelding is al behandeld.";
const goneMessage = "Deze aanmelding bestaat niet meer.";

type Group = { workingGroup: WorkingGroupSummary; requests: MembershipRequestForReview[] };

/** The list per working group, in the server's order (by organization, group, oldest first). */
function groupByWorkingGroup(requests: MembershipRequestForReview[]): Group[] {
  const groups = new Map<string, Group>();
  for (const request of requests) {
    const group = groups.get(request.workingGroup.id);
    if (group) group.requests.push(request);
    else
      groups.set(request.workingGroup.id, {
        workingGroup: request.workingGroup,
        requests: [request],
      });
  }
  return [...groups.values()];
}

/** "De aanmelding van {naam} is afgewezen.", with the name in the middle of the sentence. */
function rejectedMessage(name: string): string {
  return `De aanmelding van ${name.trim() === "" ? "deze persoon" : name} is afgewezen.`;
}

/**
 * The open requests of every working group the user reviews (`/membership-requests`). The request
 * in the address (`?request=<id>`, also from the link in the coordinator's mail) opens in a modal
 * with "Keur goed" and "Wijs af". Opening it decides nothing: only a press on a button does.
 */
export function MembershipRequestsPage() {
  return (
    <RequireManagesSomething>
      <MembershipRequests />
    </RequireManagesSomething>
  );
}

function MembershipRequests() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestId = searchParams.get("request");
  const list = useReviewableMembershipRequests();
  const approve = useApproveMembershipRequest();
  const reject = useRejectMembershipRequest();
  const deciding = approve.isPending || reject.isPending;

  const requests = list.data?.membershipRequests;
  const inList = requestId ? requests?.find((request) => request.id === requestId) : undefined;

  // The request the modal showed last. While a decision runs, the list may already lack it (the
  // live event can come before the answer); the modal keeps showing it until the answer is in.
  const shown = useRef<MembershipRequestForReview | null>(null);
  useEffect(() => {
    if (inList) shown.current = inList;
  }, [inList]);
  const decidingId = (approve.isPending ? approve.variables : reject.variables)?.id;
  const open = inList ?? (deciding && shown.current?.id === decidingId ? shown.current : null);

  // Requests this page decided or reported on itself: their disappearance from the list is not news.
  const handled = useRef(new Set<string>());
  // Requests asked for once because the address named one the list lacks.
  const asked = useRef(new Set<string>());

  // Replaces the entry, so Back after a close does not open the modal again.
  function closeRequest(id: string) {
    setSearchParams(
      (current) => {
        if (current.get("request") !== id) return current;
        const next = new URLSearchParams(current);
        next.delete("request");
        return next;
      },
      { replace: true },
    );
  }

  const listHasLoaded = requests !== undefined;
  const missing = requestId !== null && listHasLoaded && !inList && !deciding;
  useEffect(() => {
    if (!missing || requestId === null) return;
    // Already said what became of it (a decision here, a toast before): just tidy the address.
    if (handled.current.has(requestId)) return closeRequest(requestId);
    if (shown.current?.id === requestId) {
      // The modal showed it, and the list no longer holds it: a colleague decided it, or the
      // applicant withdrew.
      handled.current.add(requestId);
      showToast(alreadyDecidedMessage);
      closeRequest(requestId);
      return;
    }
    if (asked.current.has(requestId)) return;
    asked.current.add(requestId);
    void checkRequest(requestId);
    // closeRequest and checkRequest only use refs, setters and the query client.
  }, [missing, requestId]);

  /** The address names a request the list lacks: ask for it once, and say what became of it. */
  async function checkRequest(id: string) {
    const { data, error } = await getMembershipRequest({ path: { id } });
    if (data?.status === "pending") {
      // The list is older than the request: once the new list holds it, the modal opens.
      const fresh = await list.refetch();
      if (fresh.data?.membershipRequests.some((request) => request.id === id)) return;
      if (fresh.isError) {
        // The list did not load again: keep the address, so a reload tries again.
        showToast(apiErrorMessage(apiErrorCode(fresh.error)));
        return;
      }
      // Decided in the meantime after all.
      handled.current.add(id);
      showToast(alreadyDecidedMessage);
      closeRequest(id);
      return;
    }
    if (data) {
      handled.current.add(id);
      showToast(alreadyDecidedMessage);
      closeRequest(id);
      return;
    }
    const code = apiErrorCode(error);
    if (code === "not_found" || code === "not_allowed") {
      handled.current.add(id);
      showToast(goneMessage);
      closeRequest(id);
      return;
    }
    // No answer (a lost connection): say so, and keep the address, so a reload tries again.
    showToast(apiErrorMessage(code));
  }

  function decide(request: MembershipRequestForReview, decision: "approve" | "reject") {
    const mutation = decision === "approve" ? approve : reject;
    (decision === "approve" ? reject : approve).reset();
    mutation.mutate(
      { id: request.id },
      {
        onSuccess: () => {
          handled.current.add(request.id);
          showToast(
            decision === "approve"
              ? `${nameInSentence(request.applicant.name)} is toegelaten tot ${request.workingGroup.name}.`
              : rejectedMessage(request.applicant.name),
          );
          closeRequest(request.id);
        },
        onError: (error) => {
          if (apiErrorCode(error) !== "already_decided") return;
          handled.current.add(request.id);
          showToast(alreadyDecidedMessage);
          closeRequest(request.id);
        },
        // The open counts in the navigation.
        onSettled: () => void refetchAdministration(queryClient),
      },
    );
  }

  // The error of a failed decision belongs to the request it was about.
  const failed = [approve, reject].find(
    (mutation) => mutation.isError && mutation.variables?.id === open?.id,
  );

  const groups = requests ? groupByWorkingGroup(requests) : [];
  const organizationCount = new Set(groups.map((group) => group.workingGroup.organization.id)).size;

  return (
    <main className="mx-auto max-w-5xl p-4">
      <h1 className="mb-4 text-2xl font-bold">Aanmeldingen</h1>
      {/* A failed refetch keeps the list it had; only a list that never loaded is an error. */}
      {requests ? (
        <MembershipRequestTable
          groups={groups}
          showOrganization={organizationCount > 1}
          onOpen={(id) => setSearchParams({ request: id })}
        />
      ) : list.isError ? (
        <LoadError onRetry={() => void list.refetch()} />
      ) : (
        <p className="text-lg">Aanmeldingen laden…</p>
      )}
      <Modal
        open={open !== null}
        title={open ? displayName(open.applicant.name) : ""}
        // While a decision runs, the modal stays: closed, its answer would show nowhere.
        onClose={() => {
          if (open && !deciding) closeRequest(open.id);
        }}
      >
        {open ? (
          <MembershipRequestDetail
            request={open}
            pending={deciding}
            error={failed ? apiErrorMessage(apiErrorCode(failed.error)) : undefined}
            onApprove={() => decide(open, "approve")}
            onReject={() => decide(open, "reject")}
            confirmReject={false}
            heading={false}
          />
        ) : null}
      </Modal>
    </main>
  );
}

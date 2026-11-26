import {
  accountDeletionBlockers,
  apiErrorCode,
  apiErrorIssues,
  useDeleteAccountOf,
  useFindAccount,
  useMe,
} from "@padvinder/api-client";
import type { AccountSummary } from "@padvinder/contracts";
import {
  AccountSummaryCard,
  accountDeletionBlockedForOtherMessage,
  apiErrorMessage,
  ConfirmDialog,
  invalidEmailMessage,
  lastLoggedInPlatformAdminMessage,
  noAccountMessage,
  PersonEmailForm,
  showToast,
} from "@padvinder/ui";
import { useState } from "react";

/** What a search found: an account, or null when the address has none. */
type Result = { account: AccountSummary | null };

/** The name in a question or a toast; an account without a name is named by its address. */
const nameOf = (account: AccountSummary) =>
  account.name.trim() === "" ? account.email : account.name;

function searchErrors(error: unknown): { fieldError?: string; error?: string } {
  if (!error) return {};
  const code = apiErrorCode(error);
  if (code === "invalid_request" && apiErrorIssues(error)[0]?.path === "email")
    return { fieldError: invalidEmailMessage };
  return { error: apiErrorMessage(code) };
}

/** Why the deletion failed: one sentence per blocker, or the text for the code. */
function deleteErrorText(error: unknown, name: string): string {
  const blockers = accountDeletionBlockers(error);
  if (blockers.length > 0)
    return blockers
      .map((blocker) => accountDeletionBlockedForOtherMessage(name, blocker))
      .join(" ");
  const code = apiErrorCode(error);
  // The text of `DELETE /api/me` would be about the wrong person here.
  if (code === "last_platform_admin") return lastLoggedInPlatformAdminMessage;
  return apiErrorMessage(code);
}

/**
 * Deleting someone else's account (`/delete-account`, inside `RequirePlatformAdmin`), for people
 * who cannot do it themselves. The account is looked up by its whole address (sent in the body),
 * and nothing is deleted before the question is answered.
 */
export function DeleteAccountPage() {
  const me = useMe().data;
  const find = useFindAccount();
  const remove = useDeleteAccountOf();
  // A new key empties the form after a deletion.
  const [formKey, setFormKey] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [asking, setAsking] = useState(false);

  function search(email: string) {
    // A new search replaces the result; `mutate`'s callbacks run for the latest search only.
    setResult(null);
    find.mutate(email, { onSuccess: (account) => setResult({ account }) });
  }

  function askDelete() {
    remove.reset();
    setAsking(true);
  }
  // While the deletion runs, the question stays open: closed, the answer would show nowhere.
  const cancelDelete = () => {
    if (!remove.isPending) setAsking(false);
  };

  function confirmDelete(account: AccountSummary) {
    remove.mutate(account.id, {
      onSuccess: () => {
        setAsking(false);
        setResult(null);
        find.reset();
        setFormKey((key) => key + 1);
        showToast(`Het account van ${nameOf(account)} is verwijderd.`);
      },
    });
  }

  const account = result?.account ?? null;
  return (
    <main className="mx-auto max-w-5xl p-4">
      <h1 className="mb-2 text-2xl font-bold">Account verwijderen</h1>
      <p className="mb-4 text-lg text-muted-foreground">
        Zoek het account op het e-mailadres. Dit is voor mensen die hun account niet zelf kunnen
        verwijderen.
      </p>
      <div className="flex max-w-xl flex-col gap-6">
        <PersonEmailForm
          key={formKey}
          submitLabel="Zoek"
          onSubmit={search}
          pending={find.isPending}
          {...searchErrors(find.error)}
        />
        {result === null ? null : account === null ? (
          <p className="text-lg">{noAccountMessage}</p>
        ) : (
          <AccountSummaryCard
            account={account}
            own={account.id === me?.user.id}
            onDelete={askDelete}
          />
        )}
      </div>
      <ConfirmDialog
        open={asking && account !== null}
        title={account ? `Account van ${nameOf(account)} verwijderen?` : ""}
        text="Dit kun je niet terugdraaien."
        confirmLabel="Verwijder account"
        destructive
        pending={remove.isPending}
        error={remove.error && account ? deleteErrorText(remove.error, nameOf(account)) : undefined}
        onConfirm={() => {
          if (account) confirmDelete(account);
        }}
        onCancel={cancelDelete}
      />
    </main>
  );
}

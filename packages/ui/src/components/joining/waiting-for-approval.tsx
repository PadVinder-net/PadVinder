import { useState } from "react";
import { ConfirmDialog } from "../confirm-dialog";
import { Step, WideButton } from "../login/form-parts";
import { TextButton } from "../text-button";

export type WaitingForApprovalProps = {
  workingGroupName: string;
  onWithdraw(): void;
  onLogOut(): void;
  onOpenProfile(): void;
  pending: boolean;
};

export function WaitingForApproval({
  workingGroupName,
  onWithdraw,
  onLogOut,
  onOpenProfile,
  pending,
}: WaitingForApprovalProps) {
  const [asking, setAsking] = useState(false);
  return (
    <Step
      title="Welkom!"
      intro={`De coördinator van ${workingGroupName} neemt contact met je op om kennis te maken. Dat kan een paar dagen duren.`}
    >
      <WideButton type="button" variant="outline" onClick={() => setAsking(true)}>
        Trek aanmelding in
      </WideButton>
      <WideButton type="button" variant="outline" onClick={onLogOut}>
        Log uit
      </WideButton>
      <TextButton className="h-14" onClick={onOpenProfile}>
        Profiel
      </TextButton>
      <ConfirmDialog
        open={asking}
        title="Aanmelding intrekken?"
        text="Je kunt daarna een andere werkgroep kiezen."
        confirmLabel="Trek aanmelding in"
        destructive
        pending={pending}
        onConfirm={onWithdraw}
        onCancel={() => setAsking(false)}
      />
    </Step>
  );
}

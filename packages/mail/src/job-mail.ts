import type { MailJobData } from "@padvinder/db";
import {
  buildAddedMail,
  buildFirstCoordinatorMail,
  buildInvitedMail,
  buildOrganizationAdminMail,
} from "./appointment-mails";
import type { Mail } from "./mailer";

/**
 * The mail for a queued job, from the data loaded when it is sent. Links are built from the
 * public origin: the app is `{origin}/app/`, the portal `{origin}/`. The mail's `kind` is the
 * job's kind.
 */
export function buildMailForJob(data: MailJobData, origins: { publicOrigin: string }): Mail {
  const appUrl = `${origins.publicOrigin}/app/`;
  const portalUrl = `${origins.publicOrigin}/`;
  switch (data.kind) {
    case "added-to-working-group":
      return buildAddedMail({ ...data, appUrl });
    case "first-coordinator":
      return buildFirstCoordinatorMail({ ...data, portalUrl });
    case "invited-to-working-group":
      return buildInvitedMail({ ...data, appUrl });
    case "organization-admin":
      return buildOrganizationAdminMail({ ...data, portalUrl });
  }
}

export {
  buildAddedMail,
  buildFirstCoordinatorMail,
  buildInvitedMail,
  buildOrganizationAdminMail,
} from "./appointment-mails";
export { greeting } from "./greeting";
export { escapeHtml, paragraphsToHtml } from "./html";
export { buildMailForJob } from "./job-mail";
export { buildLoginCodeMail } from "./login-code-mail";
export { describeMailError } from "./mail-error";
export {
  createMemoryMailer,
  createSmtpMailer,
  smtpSettingsShape,
  smtpTransportOptions,
  type Mail,
  type Mailer,
  type SmtpSettings,
} from "./mailer";
export { buildApprovedMail, buildNewRequestMail, buildRejectedMail } from "./membership-mails";
export { buildPasskeyAddedMail, buildPasskeysRemovedMail } from "./passkey-mails";
export {
  createMemoryMailQueue,
  createQueueMail,
  ensureMailQueue,
  MAIL_QUEUE,
  MAIL_QUEUE_OPTIONS,
} from "./queue";

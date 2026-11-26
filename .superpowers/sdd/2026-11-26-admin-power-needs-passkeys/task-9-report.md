# Task 9 report
Implementation: working-group-lists.ts adds `reveals` per member list (from passkeyReveals). Requests and members screens pass hiddenGroups and onReveal (requestPasskeyConfirmation), count hidden groups in the empty check; members screen makes `reveals` groups openable; member screen passes onReveal to MemberDetail when its list reveals; system screen passes onReveal to HealthStatus. more-menu needed no change (already background, loaded lists only, full-role visibility). The request-by-address screen needed no code change: its query has no background meta; covered by a test (needs createQueryClient, not the test client, for the passkey_required caches).
TDD: 6 tests in passkey-fallback.test.tsx; RED with implementation stashed (5 failed, the plain-role one passed by design), GREEN after.
pnpm check (2724 tests) and pnpm build pass.

Follow-up: added a test for an unconfirmed org admin without memberships (names with bars, no not_allowed text, both screens) and a no-remove-button assertion in the volunteer-admin detail test. Both passed without code changes.

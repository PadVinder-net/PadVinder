# Emergency procedures

Procedures for when the application itself offers no way back. They do not depend on the host: each one says what to run in the environment's database or with the administration tool, not how to get there. How to open a database session on a host is in that host's README; for Alwaysdata, "Operating notes" in `infra/alwaysdata/README.md`.

Work in the database of the environment you mean, and only there: production and staging have separate databases.

## The last platform admin lost all passkeys

A platform admin who lost every passkey (a lost phone, a wiped laptop) is normally repaired by another platform admin, who removes their passkeys on the page Hoofdbeheerders (Verwijder toegangssleutels). When nobody else can do that, because they are the only platform admin of the environment or every other one lost theirs too, the database is the only way back: no page and no endpoint lets someone remove their own passkeys without a passkey, and that is on purpose.

1. **Open a database session** on that environment's database (see the host's README).
2. **Find the user by their whole address.** Check the address carefully, letter by letter: the next statement deletes the passkeys of whoever it names.

   ```sql
   select id from users where email = '<adres>' and deleted_at is null;
   ```

   It must give exactly one row. Addresses are stored trimmed and in lower case, so type it that way.

3. **Delete that user's passkeys,** with the ID from step 2, in one statement:

   ```sql
   delete from passkeys where user_id = '<id>';
   ```

   It answers `DELETE <n>`, the number of passkeys removed. Then close the database session (but see the last paragraph first).

4. **Log in with a code** from the mail, in the portal, and **add a new passkey as a first one** (Profiel, Toegangssleutels, Maak een toegangssleutel). Do it within a day of that login: a first passkey needs a session at most one day old. After a day, log out and log in with a new code first.

This writes no audit entry and sends no mail: the statement goes around the application, and the audit log records only what the application does. Write down yourself when and why you did it (in the maintainer's checklist or the issue about the incident). The new passkey writes its own `passkey.added` entry and sends its mail as usual.

Sessions that were confirmed with the old passkeys stay confirmed until their window ends (at most 24 hours), because the statement does not touch the sessions. When the passkeys were lost with a device that may be in someone else's hands, log that user out everywhere before step 4, in the same database session:

```sql
delete from sessions where user_id = '<id>';
```

-- Fill last_login_at for accounts that existed before it. Someone who logged in either still has a
-- session, then take the start of their newest one, or logged out (Better Auth deletes the session),
-- then email_verified proves the login, because a login with a code sets it, and updated_at is the
-- best time known. An account that was never used (made by the admin tool) and a deleted account
-- keep null.
UPDATE "users" SET "last_login_at" = coalesce(
  (SELECT max("sessions"."created_at") FROM "sessions" WHERE "sessions"."user_id" = "users"."id"),
  "users"."updated_at"
)
WHERE "users"."deleted_at" IS NULL
  AND (
    "users"."email_verified"
    OR EXISTS (SELECT 1 FROM "sessions" WHERE "sessions"."user_id" = "users"."id")
  );

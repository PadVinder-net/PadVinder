-- Everyone who has a session has logged in: take the start of their newest session. A user
-- without a session (an account made by the admin tool) keeps null.
UPDATE "users" SET "last_login_at" = "newest"."created_at"
FROM (
  SELECT "user_id", max("created_at") AS "created_at" FROM "sessions" GROUP BY "user_id"
) AS "newest"
WHERE "users"."id" = "newest"."user_id";

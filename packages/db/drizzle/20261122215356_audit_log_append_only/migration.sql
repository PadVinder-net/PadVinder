-- The audit log is append-only. Row triggers reject UPDATE and DELETE; a statement trigger rejects
-- TRUNCATE (which skips row triggers). Dropping a whole database, as the tests do, still works.
CREATE FUNCTION "audit_log_entries_reject_change"() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'audit_log_entries is append-only: % is not allowed', TG_OP
		USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "audit_log_entries_append_only"
	BEFORE UPDATE OR DELETE ON "audit_log_entries"
	FOR EACH ROW EXECUTE FUNCTION "audit_log_entries_reject_change"();
--> statement-breakpoint
CREATE TRIGGER "audit_log_entries_no_truncate"
	BEFORE TRUNCATE ON "audit_log_entries"
	FOR EACH STATEMENT EXECUTE FUNCTION "audit_log_entries_reject_change"();

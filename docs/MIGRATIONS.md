# Database Migrations

Thun.AI uses **Flyway** for database schema versioning and management.

## Why Flyway?

- **Version control:** Every schema change is tracked and numbered
- **Reproducible deployments:** Same migrations run identically on dev, staging, prod
- **Rollback capability:** Downward migrations can be created for emergency rollbacks
- **Audit trail:** History of all schema changes

## Setup

### Prerequisites

1. **Flyway CLI**: Download from https://flywaydb.org/download/community
   ```bash
   # macOS
   brew install flyway

   # Or download directly
   wget https://repo1.maven.org/maven2/org/flywaydb/flyway-commandline/9.22.3/flyway-commandline-9.22.3-linux-x64.tar.gz
   tar xzf flyway-commandline-9.22.3-linux-x64.tar.gz
   ```

2. **PostgreSQL**: Ensure database is accessible
   ```bash
   export DATABASE_URL=postgresql://user:pass@localhost:5432/thunai
   ```

### Configuration

Flyway config is in `backend/flyway.conf`:

```
flyway.locations=filesystem:./migrations
flyway.sqlMigrationPrefix=V
flyway.sqlMigrationSeparator=__
flyway.sqlMigrationSuffix=.sql
flyway.table=flyway_schema_history
flyway.baselineOnMigrate=true
```

Pass database URL via environment or CLI:
```bash
flyway -url=jdbc:postgresql://localhost:5432/thunai \
       -user=postgres \
       -password=secret \
       migrate
```

## Workflow

### 1. View Migration Status

```bash
cd backend
npm run migrate:info
```

Output:
```
+-----------+---------+------------------------------+------+---------------------+---------+
| Category  | Version | Description                  | Type | Installed On        | State   |
+-----------+---------+------------------------------+------+---------------------+---------+
| Versioned | 1       | initial schema               | SQL  | 2026-04-03 10:15:30 | Success |
| Versioned | 2       | add audit table              | SQL  | 2026-04-03 10:16:00 | Success |
| Versioned | 3       | add user sessions index      | SQL  | <not applied>       | Pending |
+-----------+---------+------------------------------+------+---------------------+---------+
```

### 2. Create a New Migration

**Naming convention:** `V{number}__{description}.sql`

Example: `V3__add_user_sessions_index.sql`

```bash
# Create the file
cat > backend/migrations/V3__add_user_sessions_index.sql << 'EOF'
-- Add indexes to improve query performance

BEGIN;

CREATE INDEX IF NOT EXISTS idx_drive_sessions_user_date 
  ON drive_sessions (user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_ivis_interventions_triggered 
  ON ivis_interventions (triggered_at DESC);

COMMIT;
EOF
```

### 3. Apply Migrations

```bash
cd backend
npm run migrate
```

This runs all pending migrations (V3, V4, etc.) in order.

## Best Practices

### ✅ DO

- **Write idempotent migrations:** Use `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`
- **Include rollback migrations:** Create `V{n}_R__description.sql` for emergency downmigrations
- **Test migrations locally first:** Run against dev db before production
- **Keep migrations small:** One logical change per file
- **Include comments:** Document _why_ schema changed, not just _what_
- **Add indexes separately:** Separate index creation into dedicated migration
- **Use transactions:** Wrap entire migration in `BEGIN; ... COMMIT;`

### ❌ DON'T

- **Modify existing migrations:** Never edit V1, V2, etc. after they're applied
- **Skip version numbers:** Always increment (V5 after V4, not V5 after V3)
- **Mix up/down migrations:** Use only upward migrations in main codebase
- **Access non-existent tables:** Test all SQL before committing
- **Rename columns directly:** Use add/drop pattern for safety

## Common Tasks

### Add a Column

```sql
-- V4__add_therapist_conversation_flag.sql
BEGIN;

ALTER TABLE drive_sessions 
  ADD COLUMN IF NOT EXISTS has_therapist_conversation BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_drive_sessions_therapist 
  ON drive_sessions (has_therapist_conversation, started_at DESC);

COMMIT;
```

### Create a New Table

```sql
-- V5__create_user_preferences_table.sql
BEGIN;

CREATE TABLE IF NOT EXISTS user_preferences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sound_enabled BOOLEAN DEFAULT TRUE,
  hud_brightness SMALLINT DEFAULT 75,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_preferences_user 
  ON user_preferences (user_id);

COMMIT;
```

### Emergency Rollback (Manual)

**WARNING:** Only use if automated recovery fails!

```bash
# List migrations
flyway -url=jdbc:postgresql://... info

# Undo a migration (manual approach: delete rows from flyway_schema_history)
psql $DATABASE_URL -c "DELETE FROM flyway_schema_history WHERE version = 4;"

# Then drop the affected tables/columns manually
psql $DATABASE_URL -c "ALTER TABLE drive_sessions DROP COLUMN IF EXISTS has_therapist_conversation;"

# Re-run migrations
npm run migrate
```

## Integration with CI/CD

```yaml
# Example GitHub Actions workflow
- name: Run database migrations
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
  run: |
    cd backend
    npm run migrate
```

## Troubleshooting

### Migration Fails

Check the flyway_schema_history table:
```sql
SELECT * FROM flyway_schema_history ORDER BY version DESC;
```

View error details:
```bash
flyway -url=... -user=... -password=... info
```

### Pending Migrations Won't Apply

Ensure database URL is correct:
```bash
psql $DATABASE_URL -c "SELECT version();"
```

Verify Flyway table exists:
```bash
psql $DATABASE_URL -c "SELECT * FROM flyway_schema_history;"
```

### Production Emergency

1. **Never modify migrations after Apply**
2. **Create downward migration if needed**
3. **Test rollback on staging first**
4. **Notify team before rolling back**

---

**For questions:** See `docs/RUNBOOKS.md` for operational procedures.

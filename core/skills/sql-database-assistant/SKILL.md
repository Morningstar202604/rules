---
name: sql-database-assistant
description: "Write SQL queries, optimize slow queries and database performance, generate migrations and schema docs; supports Prisma, Drizzle, TypeORM and SQLAlchemy. Scope boundary: queries/optimization/migrations only — for PostgreSQL table modeling use postgresql-table-design, for Supabase platform work use supabase."

description_zh: "编写 SQL 查询、优化慢查询与数据库性能、生成迁移与表结构文档，适配 Prisma、TypeORM 等 ORM。边界：只做查询/优化/迁移；PostgreSQL 表结构建模用 postgresql-table-design，Supabase 平台（Auth/RLS/Edge Functions）用 supabase。"
license: Apache-2.0
compatibility: Pure prompt-based; may read project structure via Bash.
metadata:
  version: "1.0"
  author: awesome-skillkit
  category: database
  pattern: single-task
  tier: powerful
  verified-date: "2026-09-09"
---

# SQL Database Assistant

The day-to-day companion to database-designer. **database-designer** focuses on schema architecture, ERD modeling, and multi-tenancy patterns; this skill covers the everyday: writing queries, optimizing performance, generating migrations, and bridging app code with the database engine.

**Scope boundary (three database skills, no overlap):** this skill owns **query writing, query/index optimization, migrations and schema docs** across dialects and ORMs. It does not own schema modeling rules — for PostgreSQL data types, keys, constraints, indexing strategy, partitioning and live schema-change decisions use `postgresql-table-design`; for Supabase platform concerns (Auth, RLS policies, Edge Functions, Storage, Realtime, CLI/MCP, project config) use `supabase`. When a task spans them, do the table design or platform work in the owning skill and come back here for the queries and migrations.

## Workflow

This skill proceeds through the following main flow; detailed rules for each stage are in the corresponding sections below:

1. **Take the request**: distinguish whether it's "write as SQL", "optimize existing SQL", or "design/migrate a schema" (see Natural-language-to-SQL / Query optimization / Migration generation)
2. **Feel out the schema**: confirm the table structure and column types, don't guess (see Schema exploration)
3. **Produce**: hand over the SQL or migration script, and state the assumptions (see Delivery criteria)
4. **Optimize and validate**: when there's a performance problem, run index and execution-plan analysis (see Query optimization)
5. **Self-check**: run it against the safety red lines and failure table before delivering

> When the target database differs, first confirm dialect differences in the Multi-database support section to avoid syntax incompatibility.

## Core Capabilities

- **Natural-language to SQL** — translate a request into a correct and efficient query
- **Schema exploration** — introspect live PostgreSQL, MySQL, SQLite, and SQL Server databases
- **Query optimization** — EXPLAIN analysis, index recommendations, rewrite patterns
- **Migration generation** — up/down scripts, zero-downtime strategies, rollback plans
- **ORM integration** — Prisma, Drizzle, TypeORM, SQLAlchemy patterns and escape hatches

### Tools

| Script | Purpose |
|------|------|
| `scripts/query_optimizer.py` | Statically analyze SQL queries for performance problems |
| `scripts/migration_generator.py` | Generate migration-file templates from a change description |
| `scripts/schema_explorer.py` | Turn introspection results (or a SQLite file) into schema docs |

> **Boundary / split with database-designer**: this skill's `migration_generator.py` does **natural-language → migration template** (`--change "add column ..." → up/down files`). If the need is "diff two schema JSONs and produce a formal migration SQL with rollback and zero-downtime (expand-contract)", use `database-designer`'s same-name script (`--current/--target`); the two have different responsibilities and sit upstream/downstream of each other.

## Input Checklist

| Input | Required | Description |
|------|------|------|
| SQL query or file | Conditionally required | Query text or `.sql` path, used for optimization requests |
| Change description | Conditionally required | A natural-language table-structure change, used for migration requests |
| Introspection data source | Conditionally required | An introspection JSON/CSV file, or a SQLite `.db` file, used for schema exploration |
| Dialect | Optional | `postgres` (default), `mysql`, `sqlite`, `sqlserver` |
| Output format | Optional | Defaults to stdout; each tool supports `--json` / `--output <file>` |

When inputs are missing, ask for all at once: "Please provide: (1) query / change description / introspection data (whichever the task needs), (2) target dialect (postgres/mysql/sqlite/sqlserver), (3) output format and destination. Everything else runs on defaults."

## Pre-flight Checks

Probe one by one; on any failure → give the fix and STOP:

```bash
python3 --version   # expected 3.8+; on failure: install python3
# Self-check: python3 scripts/query_optimizer.py --help / migration_generator.py / schema_explorer.py should all exit 0; on failure: script missing → check the skill directory
```

Add checks per task: optimization only needs the query text; migration generation only needs the change description; schema exploration needs an introspection file (or a SQLite file — confirm the file exists and is readable before passing `--sqlite`).

## Natural-Language to SQL

### Conversion Pattern

When turning a request into SQL, follow this order:

1. **Identify entities** — nouns map to tables
2. **Identify relationships** — verbs map to JOINs or subqueries
3. **Identify filters** — adjectives/conditions map to WHERE clauses
4. **Identify aggregations** — "total"/"average"/"count" map to GROUP BY
5. **Identify ordering** — "top N"/"newest"/"highest" map to ORDER BY + LIMIT

### Common Query Templates

**Top-N per group (window functions)**

```sql
SELECT * FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY department_id ORDER BY salary DESC) AS rn
  FROM employees
) ranked WHERE rn <= 3;
```

**Running total**

```sql
SELECT date, amount,
  SUM(amount) OVER (ORDER BY date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_total
FROM transactions;
```

**Gap detection**

```sql
SELECT curr.id, curr.seq_num, prev.seq_num AS prev_seq
FROM records curr
LEFT JOIN records prev ON prev.seq_num = curr.seq_num - 1
WHERE prev.id IS NULL AND curr.seq_num > 1;
```

**UPSERT (PostgreSQL)**

```sql
INSERT INTO settings (key, value, updated_at)
VALUES ('theme', 'dark', NOW())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;
```

**UPSERT (MySQL)**

```sql
INSERT INTO settings (key_name, value, updated_at)
VALUES ('theme', 'dark', NOW())
ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at);
```

> For more patterns — JOINs, CTEs, window functions, JSON operations — see references/query_patterns.md.

## Schema Exploration

### Introspection Queries

**PostgreSQL — list tables and columns**

```sql
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
```

**PostgreSQL — foreign keys**

```sql
SELECT tc.table_name, kcu.column_name,
  ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY';
```

**MySQL — table sizes**

```sql
SELECT table_name, table_rows,
  ROUND(data_length / 1024 / 1024, 2) AS data_mb,
  ROUND(index_length / 1024 / 1024, 2) AS index_mb
FROM information_schema.tables
WHERE table_schema = DATABASE()
ORDER BY data_length DESC;
```

**SQLite — export the schema**

```sql
SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name;
```

**SQL Server — columns and types**

```sql
SELECT t.name AS table_name, c.name AS column_name,
  ty.name AS data_type, c.max_length, c.is_nullable
FROM sys.columns c
JOIN sys.tables t ON c.object_id = t.object_id
JOIN sys.types ty ON c.user_type_id = ty.user_type_id
ORDER BY t.name, c.column_id;
```

### Generating Docs From a Schema

Run `scripts/schema_explorer.py` — the two inputs are mutually exclusive; one is required:

```bash
# Extract from a SQLite database (opened read-only), filter by a single table, JSON output
python3 scripts/schema_explorer.py --sqlite assets/sample.db --table users --json   # bundled sample DB (users/orders, two tables); swap in app.db for your real DB

# Generate Markdown docs from an introspection file (JSON/CSV; `-` reads stdin)
python3 scripts/schema_explorer.py --input assets/introspection.json -o schema_doc.md   # bundled sample (row-wise introspection: at least table_name/column_name/data_type)
```

Expected: stdout emits a Markdown schema doc, or writes to the path given by `-o`; `--json` switches to normalized JSON. On failure: neither `--input` nor `--sqlite` given → the script exits with a usage error; supply one data source; the introspection file is malformed → regenerate it with the queries above.

## Query Optimization

### EXPLAIN Analysis Workflow

1. **Run EXPLAIN ANALYZE** (PostgreSQL) or **EXPLAIN FORMAT=JSON** (MySQL)
2. **Locate the most expensive node** — a Seq Scan on a large table, a Nested Loop with over-estimated rows
3. **Check for missing indexes** — sequential scans on filtered columns
4. **Watch estimate drift** — large gaps between estimated and actual rows mean stale statistics
5. **Evaluate JOIN order** — let the smallest result set drive the join

### Index Recommendation Checklist

- High-selectivity columns in WHERE clauses
- Columns in JOIN conditions (foreign keys)
- ORDER BY columns combined with LIMIT
- Composite indexes matching multi-column WHERE predicates (highest-selectivity column first)
- Partial indexes for constant-filtered queries (e.g. `WHERE status = 'active'`)
- Covering indexes for read-heavy cases to avoid lookups into the table

### Query Rewrite Patterns

| Anti-pattern | Rewrite |
|--------|------|
| `SELECT * FROM orders` | `SELECT id, status, total FROM orders` (list columns explicitly) |
| `WHERE YEAR(created_at) = 2025` | `WHERE created_at >= '2025-01-01' AND created_at < '2026-01-01'` (index-friendly) |
| A correlated subquery in the SELECT | LEFT JOIN + aggregation |
| `NOT IN (SELECT ...)` with NULLs | `NOT EXISTS (SELECT 1 ...)` |
| `UNION` when dedup isn't needed | `UNION ALL` |
| `LIKE '%search%'` | A full-text index (GIN/FULLTEXT) |
| `ORDER BY RAND()` | App-side random sampling or `TABLESAMPLE` |

### Static Analysis Tool

```bash
python3 scripts/query_optimizer.py --query "SELECT * FROM orders WHERE status = 'pending'" --dialect postgres
python3 scripts/query_optimizer.py --query queries.sql --dialect mysql --json
```

Expected: per-statement findings (anti-patterns, index hints); `--json` gives machine-readable results. On failure: `--query` takes either a SQL string or a `.sql` file path — the path is treated as a file and errors if it doesn't exist; check the path.

> For reading EXPLAIN plans, index types, and connection pooling, see references/optimization_guide.md.

## Migration Generation

### Zero-Downtime Migration Patterns

**Add a column (safe)**

```sql
-- Up
ALTER TABLE users ADD COLUMN phone VARCHAR(20);

-- Down
ALTER TABLE users DROP COLUMN phone;
```

**Rename a column (expand-contract)**

```sql
-- Step 1: add the new column
ALTER TABLE users ADD COLUMN full_name VARCHAR(255);
-- Step 2: backfill
UPDATE users SET full_name = name;
-- Step 3: deploy the app reading both columns
-- Step 4: deploy the app writing only the new column
-- Step 5: drop the old column
ALTER TABLE users DROP COLUMN name;
```

**Add a NOT NULL column (safe order)**

```sql
-- Step 1: add the nullable column
ALTER TABLE orders ADD COLUMN region VARCHAR(50);
-- Step 2: backfill with a default
UPDATE orders SET region = 'unknown' WHERE region IS NULL;
-- Step 3: add the constraint
ALTER TABLE orders ALTER COLUMN region SET NOT NULL;
ALTER TABLE orders ALTER COLUMN region SET DEFAULT 'unknown';
```

**Build an index (non-blocking, PostgreSQL)**

```sql
CREATE INDEX CONCURRENTLY idx_orders_status ON orders (status);
```

### Backfill and Rollback Strategies

- **Batch updates** — 1000-10000 rows per batch to avoid lock contention; **dual-write** the old and new columns during the transition; verify row counts after each batch
- Every migration must have a reversible down script. For irreversible changes: `pg_dump` the affected tables first, switch the read path with a feature flag, or keep a shadow-table copy in a maintenance window

### Migration Generation Tool

```bash
python3 scripts/migration_generator.py --change "add email_verified boolean to users" --dialect postgres --format sql
python3 scripts/migration_generator.py --change "rename column name to full_name in customers" --dialect mysql --format alembic --json
```

Expected: by `--format` (`sql`/`prisma`/`alembic`), output up/down migration templates (SQL) or Alembic/Prisma templates; `--output` writes to a file instead of stdout. On failure: the change phrasing isn't recognized — rephrase as "add/drop/rename column X to/in table Y"; dialect unsupported — pick one of the four above.

## Multi-Database Support and ORMs

Dialect differences across engines (UPSERT / booleans / auto-increment / JSON / window functions — a 9-item comparison) and the schema definitions, migration commands, and query APIs of the four major ORMs (Prisma / SQLAlchemy / TypeORM / GORM) are organized in the reference files; read them when needed:

- [dialect_and_orm.md](references/dialect_and_orm.md) — dialect comparison table + compatibility notes + ORM patterns
- [orm_patterns.md](references/orm_patterns.md) — deep ORM patterns and relation queries
- [optimization_guide.md](references/optimization_guide.md) — index and execution-plan optimization
- [query_patterns.md](references/query_patterns.md) — common query recipes

> Before a cross-engine migration, confirm syntax compatibility against the dialect table; before writing ORM code, confirm the target ORM's migration-command shape.

## Data Integrity

### Constraint Strategy

- **Primary keys** — every table must have one; prefer surrogate keys (serial/UUID)
- **Foreign keys** — enforce referential integrity; define ON DELETE behavior explicitly
- **UNIQUE constraints** — business-level uniqueness (email, slug, API key)
- **CHECK constraints** — validate ranges, enums, and business rules at the database layer
- **NOT NULL** — default to NOT NULL; relax it only where genuinely nullable

### Transaction Isolation Levels

| Level | Dirty reads | Non-repeatable reads | Phantom reads | Use case |
|------|------|-----------|------|----------|
| READ UNCOMMITTED | Yes | Yes | Yes | Not recommended |
| READ COMMITTED | No | Yes | Yes | PostgreSQL default, general OLTP |
| REPEATABLE READ | No | No | Yes (InnoDB: no) | Financial calculations |
| SERIALIZABLE | No | No | No | Strong-consistency cases (billing, inventory) |

### Deadlock Prevention

1. **Consistent lock ordering** — always access tables/rows in the same order
2. **Short transactions** — compress the time from first lock to commit
3. **Advisory locks** — use `pg_advisory_lock()` for app-level coordination
4. **Retry logic** — catch deadlock errors and retry with exponential backoff

## Backup and Recovery

### PostgreSQL

```bash
# Full backup
pg_dump -Fc --no-owner dbname > backup.dump
# Restore
pg_restore -d dbname --clean --no-owner backup.dump
# Point-in-time recovery: configure WAL archiving + restore_command
```

### MySQL

```bash
# Full backup
mysqldump --single-transaction --routines --triggers dbname > backup.sql
# Restore
mysql dbname < backup.sql
# PITR with binary logs: mysqlbinlog --start-datetime="2025-01-01 00:00:00" binlog.000001
```

### SQLite

```bash
# Backup (safe under concurrent reads)
sqlite3 dbname ".backup backup.db"
```

Backup discipline: automated backups, periodically rehearsed restores, offsite copies — a backup whose restore hasn't been verified isn't a backup.

## Anti-patterns

| Anti-pattern | Problem | Fix |
|--------|------|------|
| `SELECT *` | Transfers extra data; breaks on schema changes | Explicit column list |
| Unindexed foreign-key columns | Slow JOINs, slow cascading deletes | Index every foreign key |
| N+1 queries | 1 + N round trips; ORM lazy-loading in loops shows up as many identical SELECTs | Eager loading (`include`/`joinedload`), `WHERE id IN (...)`, or DataLoader |
| Implicit type conversion | `WHERE id = '123'` blocks index use | Same types on both sides of the predicate |
| No connection pool | Connection exhaustion under load | PgBouncer, ProxySQL, or an ORM pool |
| Unbounded queries | No LIMIT can return millions of rows | Always paginate |
| Storing money in FLOAT | Rounding errors | Use `DECIMAL(19,4)` or integer cents |
| God table | One table with 50+ columns | Normalize or vertically split |
| Soft deletes everywhere | Every query needs `WHERE deleted_at IS NULL` | Archive tables or event sourcing |
| String-concatenated SQL | SQL injection | Always parameterized queries |

## Failure Handling Table

| Symptom / error | Cause | Fix |
|-------------|------|------|
| `schema_explorer.py` usage error (missing data source) | Neither `--input` nor `--sqlite` provided | Provide exactly one; the two are mutually exclusive |
| `query_optimizer.py` file-not-found on `--query` | The path is treated as a file but doesn't exist | Pass a quoted SQL string instead, or check the `.sql` path |
| The migration template doesn't match intent | The change phrasing wasn't recognized | Rephrase as "add/drop/rename column X in table Y" |
| Wrong dialect output | `--dialect` wasn't passed, defaulting to postgres | Always pass `--dialect` matching the user's engine |
| The generated SQL errors on the target engine | Shared code used dialect-specific syntax | Check the dialect table above; wrap dialect-specific features in an adapter |

## Delivery Criteria

- Definition of success: dialect-correct SQL with optimization rationale, or a migration template with a matching down script, or schema docs faithfully reflecting the real data source.
- Artifact naming: migration files `<timestamp>_<name>.up.sql` / `.down.sql` (or Alembic/Prisma per `--format`); schema docs `schema_doc.md` / `.json`.
- Save location: migrations go in the project's `migrations/` directory; schema docs go in `docs/` or the project root.
- Completeness verification: every query passes the optimizer with no anti-pattern warnings (or the warnings are intentionally waived); every migration has a down script; the schema doc covers every table in the introspection data source.

## Safety Red Lines

- Never run generated SQL directly against a live database — artifacts are for review. Destructive DDL (DROP/DELETE/TRUNCATE) must be flagged to the user.
- Credentials go in environment variables or a connection config, never inline in a query or doc.
- The `pg_dump`/`mysqldump` commands above are for the user to run; only run them when the user explicitly asks and provides credentials.

## References

- `references/query_patterns.md` — read when writing JOINs, CTEs, window functions, or JSON operations
- `references/optimization_guide.md` — read when reading EXPLAIN plans or choosing index types
- `references/orm_patterns.md` — read when the task lives inside an ORM (Prisma/Drizzle/TypeORM/SQLAlchemy)

## Related Skills

| Skill | Relationship |
|------|------|
| **database-designer** | Schema architecture, normalization analysis, ERD generation, RLS/multi-tenancy patterns |
| **migration-architect** | Complex multi-step migration orchestration |
| **api-design-reviewer** | Ensuring API endpoints align with query patterns |
| **observability-platform**（上游生态技能，未随包收录） | Query-performance monitoring, slow-query alerting |

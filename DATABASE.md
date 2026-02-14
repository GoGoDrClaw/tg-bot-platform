# Database Configuration

Bot Platform supports two database backends: **SQLite** and **PostgreSQL**.

## Quick Start

Set the database type in your `.env` file:

```env
# Use SQLite (default, recommended for most cases)
DB_TYPE=sqlite

# OR use PostgreSQL
DB_TYPE=postgres
DB_URL=postgres://user:password@host:5432/database
```

## SQLite vs PostgreSQL

### 🗄️ SQLite (Recommended for most users)

**When to use:**
- ✅ Small to medium deployments (1-50 bots)
- ✅ Single server setup
- ✅ Easy setup with no external dependencies
- ✅ Simple backup (just copy the `.sqlite` file)
- ✅ Development and testing

**Pros:**
- Zero configuration - works out of the box
- File-based - easy to backup and restore
- No separate database server needed
- Fast for small datasets
- Perfect for Docker single-container deployments

**Cons:**
- Not ideal for high-concurrency writes
- Limited to single server (no clustering)
- Max database size ~281 TB (more than enough for most cases)

**Configuration:**
```env
DB_TYPE=sqlite
# Optional: custom path (default: storage/data.sqlite)
SQLITE_PATH=storage/data.sqlite
```

**Backup:**
```bash
# Backup
cp storage/data.sqlite storage/backup-$(date +%Y%m%d).sqlite

# Restore
cp storage/backup-20260214.sqlite storage/data.sqlite
```

---

### 🐘 PostgreSQL (For large deployments)

**When to use:**
- ✅ Large deployments (50+ bots)
- ✅ Multiple server instances (load balancing)
- ✅ Need for advanced queries and analytics
- ✅ High-concurrency environments
- ✅ Production-grade reliability and replication

**Pros:**
- Enterprise-grade reliability
- Advanced features (triggers, views, materialized views)
- Better performance for complex queries
- Clustering and replication support
- ACID compliance with advanced features

**Cons:**
- Requires separate PostgreSQL server
- More complex setup and maintenance
- Overkill for small deployments

**Configuration:**
```env
DB_TYPE=postgres
DB_URL=postgres://user:password@localhost:5432/bot-platform

# Alternative: separate variables
DB_HOST=postgres
DB_PORT=5432
DB_USER=bot
DB_PASSWORD=bot
DB_NAME=bot-platform
```

**Docker Compose example:**
```yaml
services:
  bot-manager:
    environment:
      - DB_TYPE=postgres
      - DB_URL=postgres://bot:bot@postgres:5432/bot-platform

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: bot
      POSTGRES_PASSWORD: bot
      POSTGRES_DB: bot-platform
    volumes:
      - postgres-data:/var/lib/postgresql/data

volumes:
  postgres-data:
```

## Migration Between Databases

### SQLite → PostgreSQL

1. **Export data from SQLite:**
```bash
# Install pgloader
brew install pgloader  # macOS
apt-get install pgloader  # Ubuntu

# Migrate
pgloader storage/data.sqlite postgresql://user:password@host:5432/bot-platform
```

2. **Update `.env`:**
```env
DB_TYPE=postgres
DB_URL=postgres://user:password@host:5432/bot-platform
```

3. **Restart Bot Platform**

### PostgreSQL → SQLite

1. **Export data:**
```bash
# Using pg_dump and custom script (not recommended for production)
pg_dump -h host -U user -d bot-platform --data-only > dump.sql
```

2. **Import to SQLite:**
```bash
# Convert SQL dump to SQLite format (manual process)
# It's easier to recreate data than migrate from PostgreSQL to SQLite
```

**Note:** Migrating from PostgreSQL to SQLite is not recommended. If you started with PostgreSQL, stay with it.

## Database Schema

Both databases use the same schema (managed by TypeORM):

**Tables:**
- `bot` - Bot configurations
- `bot_env` - Environment variables for each bot
- `bot_runtime_meta` - Runtime metadata (ports, status, etc.)
- `user` - User accounts (Telegram auth)
- `bot_access` - Bot sharing and permissions

**Automatic migrations:**
- TypeORM `synchronize: true` automatically creates and updates tables
- No manual migrations needed
- Schema changes are applied on app startup

## Performance Tuning

### SQLite Optimization

```env
# For SQLite, ensure WAL mode for better concurrency
# (Automatically enabled by TypeORM)
```

**Tips:**
- Keep database file on SSD for better performance
- Regular VACUUM to optimize file size:
```bash
sqlite3 storage/data.sqlite "VACUUM;"
```

### PostgreSQL Optimization

**Connection pooling (handled by TypeORM):**
- Default: 10 connections
- Automatically managed

**Indexes (automatically created):**
- Primary keys on all tables
- Foreign keys for relations
- Unique constraints where needed

## Monitoring

### Check database size

**SQLite:**
```bash
ls -lh storage/data.sqlite
```

**PostgreSQL:**
```sql
SELECT pg_size_pretty(pg_database_size('bot-platform'));
```

### Check table sizes

**SQLite:**
```bash
sqlite3 storage/data.sqlite "SELECT name, SUM(pgsize) as size FROM dbstat GROUP BY name;"
```

**PostgreSQL:**
```sql
SELECT tablename, pg_size_pretty(pg_total_relation_size(tablename::text))
FROM pg_tables
WHERE schemaname = 'public';
```

## Troubleshooting

### "Database is locked" (SQLite)

**Cause:** Multiple processes accessing the same SQLite file
**Solution:**
- Ensure only one Bot Platform instance is running
- Check for zombie processes: `ps aux | grep node`
- Kill zombie processes: `pkill -f "node.*bot-manager"`

### "Connection refused" (PostgreSQL)

**Cause:** PostgreSQL server not running or wrong connection details
**Solution:**
- Check PostgreSQL is running: `docker ps | grep postgres`
- Verify connection details in `.env`
- Test connection: `psql postgresql://user:password@host:5432/database`

### "Too many connections" (PostgreSQL)

**Cause:** Connection pool exhausted
**Solution:**
- Increase PostgreSQL max_connections
- Check for connection leaks in your code
- Restart Bot Platform to reset pool

## Best Practices

1. **Start with SQLite** - It's simpler and sufficient for most use cases
2. **Backup regularly** - Both databases support backups
3. **Monitor disk space** - Especially important for SQLite
4. **Use PostgreSQL only when needed** - Don't over-engineer
5. **Test migrations** - Before migrating production data

## FAQ

**Q: Can I switch databases later?**
A: Yes, but migration requires some work. Start with SQLite and migrate to PostgreSQL only if needed.

**Q: Which is faster?**
A: SQLite is faster for small datasets. PostgreSQL is faster for complex queries and high concurrency.

**Q: Can I use other databases?**
A: Theoretically yes (TypeORM supports MySQL, MariaDB), but only SQLite and PostgreSQL are tested.

**Q: What's the recommended setup?**
A: SQLite for 95% of use cases. PostgreSQL only for large deployments (50+ bots) or multi-server setups.

**Q: How much storage do I need?**
A: Typical usage: ~1-5 MB per bot (logs, metadata). A 100-bot deployment needs ~500 MB.

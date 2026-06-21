# PostgreSQL + pgvector Setup

## Prerequisites

- Windows 10/11 (64-bit)
- Administrator access

## Step 1 — Install PostgreSQL

### Option A — EDB Installer (recommended for Windows)

1. Download the latest PostgreSQL installer from [EDB Download Page](https://www.enterprisedb.com/downloads/postgres-postgresql-downloads)
   - Choose version **16** or later (tested with 18)
   - Windows x86-64 installer

2. Run the installer:
   - Accept defaults
   - Set a strong password for the `postgres` superuser (remember it!)
   - Port: `5432` (default)
   - Locale: your system default

3. After installation, PostgreSQL runs as a Windows service named `postgresql-x64-18`.

### Option B — Winget (if available)

```powershell
winget install PostgreSQL.PostgreSQL.18 --accept-source-agreements --accept-package-agreements
```

### Verify Installation

```powershell
# Add PostgreSQL to PATH (adjust version number)
$env:Path += ";C:\Program Files\PostgreSQL\18\bin"

# Check version
psql --version

# Check service status
Get-Service -Name "postgresql*"
```

## Step 2 — Start PostgreSQL

If the service is not running:

```powershell
# Start the service
Start-Service -Name "postgresql-x64-18"

# Or start manually (if service not registered)
pg_ctl start -D "C:\Program Files\PostgreSQL\18\data" -w -t 30

# Verify it's accepting connections
pg_isready -h localhost -p 5432
```

## Step 3 — Create Database & User

```powershell
# Connect as superuser
psql -h localhost -U postgres

-- Create the database
CREATE DATABASE argentinaradar_v2;

-- Create the application user
CREATE USER argentinaradar WITH PASSWORD 'ArgentinaRadar2024!';

-- Grant database access
GRANT ALL PRIVILEGES ON DATABASE argentinaradar_v2 TO argentinaradar;

-- Grant schema permissions (connect as database owner first)
\c argentinaradar_v2 postgres
GRANT ALL ON SCHEMA public TO argentinaradar;

-- Exit psql
\q
```

## Step 4 — Enable pgvector Extension

pgvector is packaged with the EDB installer. Enable it on the database:

```powershell
psql -h localhost -U postgres -d argentinaradar_v2 -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

Verify it's installed:

```powershell
psql -h localhost -U postgres -d argentinaradar_v2 -c "\dx"
```

You should see `vector` in the list of installed extensions.

### Important

The `vector` extension **must be enabled BEFORE** creating any tables that use the `vector(1536)` type. Prisma migrations will fail otherwise.

## Step 5 — Configure Authentication (pg_hba.conf)

The default installation uses `md5` (password) authentication for local connections.
If you need to change this (e.g., for development), edit:

```
C:\Program Files\PostgreSQL\18\data\pg_hba.conf
```

Find the line:
```
host    all             all             127.0.0.1/32            scram-sha-256
```

Change to `trust` for local development (not recommended for production):

```
host    all             all             127.0.0.1/32            trust
```

Then restart PostgreSQL:

```powershell
pg_ctl restart -D "C:\Program Files\PostgreSQL\18\data" -w -t 30
```

## Step 6 — Run Prisma Migration

From the project root:

```bash
cd packages/database

# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Run initial migration
npx prisma migrate dev --name init

# (Optional) Open Prisma Studio to verify
npx prisma studio
```

## Step 7 — Verify Everything

```powershell
# List databases
psql -h localhost -U postgres -l

# Connect and check tables
psql -h localhost -U argentinaradar -d argentinaradar_v2 -c "\dt"

# Check extensions
psql -h localhost -U postgres -d argentinaradar_v2 -c "SELECT * FROM pg_extension;"

# Check pgvector works
psql -h localhost -U postgres -d argentinaradar_v2 -c "SELECT * FROM vector_dims('vector(1536)');"
```

## Troubleshooting

### "pre-existing shared memory block is still in use"

This happens when PostgreSQL was not shut down cleanly.

**Solution**: Restart your Windows session (log off and log back in), or use:

```powershell
# Kill all postgres processes
Get-Process -Name "postgres" | Stop-Process -Force
# Wait a few seconds, then start again
pg_ctl start -D "C:\Program Files\PostgreSQL\18\data" -w -t 30
```

### "client backend was terminated by exception 0xC0000142"

This is a DLL initialization error. Possible causes:
- Missing Visual C++ Redistributable — install from [Microsoft](https://aka.ms/vs/17/release/vc_redist.x64.exe)
- Antivirus blocking process creation — add PostgreSQL to antivirus exclusions
- Corrupt installation — reinstall PostgreSQL via EDB installer

### Port 5432 already in use

```powershell
# Check what's using the port
netstat -ano | Select-String ":5432"

# Kill the process (replace PID)
Stop-Process -Id <PID> -Force
```

### "relation does not exist" after Prisma migration

Make sure you're connecting to the correct database (`argentinaradar_v2`) and the migration has been applied:

```bash
npx prisma migrate deploy
```

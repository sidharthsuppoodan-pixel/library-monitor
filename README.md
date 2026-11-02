# Library Sound Monitoring System

Monitor relative sound levels in a library using an ESP32 and KY-038 sensor, with local LEDs/buzzer and a live web dashboard.

ESP32 + KY-038 → HTTPS → FastAPI → PostgreSQL → library dashboard.

**Scores are relative analog peak-to-peak values (0–4095), not calibrated decibels.** This project is not a calibrated sound-level instrument. The original sketch mentioned in the handover was not attached as a usable file; the included sketch is a new implementation of that specification.

## Start here

1. **Run on your computer:** follow the Docker steps below.
2. **Test the hardware:** [Hardware setup](docs/HARDWARE.md).
3. **Host on Render:** [Beginner deployment guide](docs/RENDER.md).
4. **Operate it:** [Backups, updates and recovery](docs/OPERATIONS.md).
5. **Understand the API:** [API reference](docs/API.md).
6. **See what was verified:** [Verification report](docs/VERIFICATION.md).

## Local Docker setup

Install and open Docker Desktop on your Mac. Run these commands in **Mac Terminal**, inside this project's `iot` folder:

```sh
python3 scripts/init_env.py
docker compose up -d --build
docker compose ps
```

Open **http://localhost:8000**. In a text editor, open the new private `.env` file and copy only the value after `DASHBOARD_API_KEY=` into the dashboard. Do not share this file. The page starts empty; it does not show fabricated readings.

To confirm database readiness:

```sh
curl --fail http://localhost:8000/health
```

Expected response: `{"status":"ok"}`.

The dashboard starts empty. Connect the configured ESP32 to receive real readings; no demo data is seeded.

Stop the local stack with `docker compose down`. Data remains in the named volume. **`docker compose down -v` deletes that data.** The local API binds to your computer's loopback interface. The ESP32 firmware uses the public Render HTTPS URL once deployed.

## Included

- FastAPI API with strict payload validation, separate write/read keys, scoped device identity, bounded request sizes, an ingest rate limit and retry deduplication.
- PostgreSQL schema, Alembic migrations, indexes, UTC server receipt timestamps, bounded pagination and chart queries.
- Responsive white dashboard with login, five-second refresh, pause/resume, a device setup panel, stale/offline state, time ranges, history and displayed-row CSV export. No third-party scripts or browser microphone access.
- ESP32 firmware preserving GPIO 34 / 18 / 19 / 23, TLS certificate verification, NTP, reconnects, bounded RAM queue, retry backoff and local indicators independent of network uploads.
- Non-root Docker image, Compose health checks, persistent local data, log rotation, automatic 30-day retention and backup helper.
- Render Blueprint for a Docker web service, managed Postgres and daily retention job, plus manually run tests and locked Python dependencies with hashes.

## Production scope

This release targets **one ESP32 and one small shared dashboard**, with one application instance/worker. Keys are shared bearer credentials, not individual user accounts. Device and dashboard keys must differ. Retrying without an `event_id` is accepted for legacy devices but cannot deduplicate. Retention defaults to 30 days; timestamps reflect server receipt, including retried uploads. Queue contents are RAM-only and can be lost on reset or extended outages.

Render hosting requires your own GitHub and Render accounts and billing for the included always-on plans. No cloud resources have been created by this project. Physical wiring, sensor behavior, Wi-Fi and production certificates must be verified on your ESP32. This is a deployment-ready implementation subject to the verification limits recorded in the report, not a claim of an already validated live installation.

## Project layout

```text
app/                       API, database models, dashboard
alembic/                   Versioned database migrations
firmware/                  Arduino sketch and example configuration
scripts/                   Startup, local secrets, retention, backup
tests/                    Real-PostgreSQL integration tests
Dockerfile                 Runtime image
compose.yaml               Local Docker stack
render.yaml                Render cloud deployment
```

## Development tests

Use a separate PostgreSQL test database. Tests truncate `readings` and must never target production.

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install --require-hashes -r requirements-dev.txt
# Set DATABASE_URL to a dedicated PostgreSQL TEST database.
# Set distinct DEVICE_API_KEY and DASHBOARD_API_KEY values (32+ characters).
alembic upgrade head
python -m pytest -q
```

No CI/CD workflow is included. Run tests locally before a manual deployment. For an existing developer environment, use `alembic upgrade head` before starting `uvicorn app.main:app`; schema changes are intentionally not run by each web worker.

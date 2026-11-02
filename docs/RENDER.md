# Deploy to Render, step by step

Use your web browser for account setup. Use **Mac Terminal** only for the command blocks below. No cloud deployment has happened yet.

## 1. Create the two accounts

1. Create your [GitHub account](https://github.com/signup).
2. Create a private GitHub repository named `noise`. Leave its README, license and `.gitignore` unchecked because this project already contains files.
3. Create a [Render account](https://dashboard.render.com/register). Connect GitHub when Render asks and grant access only to this repository.

The included Blueprint provisions a Free Tier web service (hosting both frontend and backend) and a Free PostgreSQL database.

## 2. Upload the project to GitHub

Open Mac Terminal in the project folder, then run:

```sh
git add .
git commit -m "Configure Library Monitor for Render deployment"
git branch -M main
git remote add origin https://github.com/<your-username>/library-monitor.git
git push -u origin main
```

Keep `Dockerfile` and `render.yaml` at the repository root.

## 3. Create the Blueprint

1. In Render choose **New → Blueprint** (or click the Blueprint deploy link).
2. Select your repository and branch `main`.
3. Use `render.yaml` as the Blueprint path.
4. Review the two resources (Web Service + PostgreSQL Database, both on Free tier).
5. Click **Apply Blueprint**.
6. Wait for the database and web service to become healthy. The web service builds the Dockerfile, runs `alembic upgrade head` on container startup, then starts the API and serves the dashboard.


The database's external access list is empty; the app uses Render's internal connection string. Render terminates HTTPS for the public web service. Python runs one worker and listens on Render's `PORT`. No reverse proxy container or Docker Compose is needed on Render.

## 4. Open the app and retrieve its keys

1. Open the web service and copy its actual `https://…onrender.com` URL.
2. Visit that URL with `/health` appended. Expect `{"status":"ok"}`.
3. In the web service's **Environment** settings, reveal `DASHBOARD_API_KEY`; paste its value into the dashboard login.
4. Reveal `DEVICE_API_KEY`; copy it into the ESP32's private `config.h`.
5. Set the ESP32 `API_URL` to `https://YOUR-ACTUAL-SERVICE.onrender.com/readings` and configure its issuing root CA as described in [Hardware](HARDWARE.md).

Render generates distinct random keys automatically. The dashboard key stays in tab memory; reloading locks the page. The device key can submit readings but cannot read the dashboard's data. Never put either key in a URL, screenshot, Git commit or chat message.

## 5. Verify the complete path

1. Upload the sketch and open Arduino Serial Monitor at 115200.
2. Confirm an upload HTTP status of `201` (`200` is a successfully deduplicated retry).
3. Open the dashboard. A new reading should appear within five seconds.
4. Make a brief sound near the sensor and observe the relative score. Tune the threshold; do not interpret it as dB.
5. Disconnect ESP32 power. After 30 seconds without new data, the dashboard should say **Device offline**.
6. Reconnect the board and confirm readings resume.

Do not call the installation complete until these checks pass on actual hardware.

## Updating the application

Automatic deployments are disabled in the Blueprint. Run the local tests, push your change, then choose Render's manual deploy of that commit. If changing `render.yaml`, review the Blueprint sync as well. Back up data before migrations. Keep migrations backward-compatible so the previous image can serve during deployment. Deploy or update the retention service when its source changes.

## Common problems

| Symptom | Check |
| --- | --- |
| Build fails | Copy the exact first error from Render build logs. Confirm the root contains `requirements.txt`, `Dockerfile` and `app/`. |
| Health check fails | Check pre-deploy migration logs, internal `DATABASE_URL`, database availability and credentials. |
| HTTP 401 on ESP32 | Device key must match Render's `DEVICE_API_KEY`, including capitalization. |
| Negative HTTP status | Check Wi-Fi, NTP time, HTTPS URL and root CA. Do not disable TLS verification. |
| HTTP 422 | Payload needs an integer score from 0 to 4095 and a JSON boolean `noisy`. |
| HTTP 429 | Keep the normal two-second interval; allow retry backoff. |
| Dashboard offline | Device hasn't reached the API recently; look at Serial Monitor. |

References checked while preparing this project: [Render Docker](https://render.com/docs/docker), [Blueprint specification](https://render.com/docs/blueprint-spec), [health checks](https://render.com/docs/health-checks). Render may change plan names and UI labels; the Blueprint creation screen is the final validation for your account.

# SchoolBridge shared browser preview

This is a controlled preview deployment for hosted PWA delivery, school QR onboarding, and remote-access integration testing. It is separate from each school's offline Windows installation. **Use fictional test records only; do not enter real student, parent, staff, financial, or other personal information.**

## Shared hosting design

One shared hosted application serves multiple schools. Each school uses its own public QR identity and tenant-scoped records.

- **Render Static Site** serves the Vite frontend/PWA over HTTPS and its global CDN.
- **The existing Render Web Service** runs the FastAPI backend using the repository's `backend/Dockerfile`.
- **The existing Neon project** provides the hosted PostgreSQL database. Reuse the database already created for the `schoolbridge-ug` Render service; do not create another Neon project.
- **The local school installation** continues to use its own local database and must remain usable without internet access.

The hosted API and Neon database support remote access. They do not, by themselves, synchronise a school's local SQLite database with Neon. Do not assume local records are mirrored to the hosted database; only use a separately implemented and tested synchronisation workflow for that purpose.

## 1. Check the existing Neon connection

1. Open the existing Neon project and use its PostgreSQL connection details. Do not create a replacement project.
2. Use the pooled connection string for the hosted Render API service. Keep it private; never put it in Git, a frontend variable, a screenshot, or a message.
3. SchoolBridge uses SQLAlchemy with Psycopg 3. The connection URL supplied to `SCHOOLBRIDGE_DATABASE_URL` must use the `postgresql+psycopg://` scheme and retain Neon's required TLS query parameters (normally `sslmode=require`).
4. Confirm that the existing Render service has the connection string stored as the private environment variable `SCHOOLBRIDGE_DATABASE_URL`. If it is already configured and healthy, do not replace it.
5. SchoolBridge runs its pending database migrations during backend startup. Keep a verified backup before deploying schema changes.

## 2. Verify the existing Render API service

Use the existing Render Web Service named `schoolbridge-ug`; do not create a second API service unless the existing one is confirmed unusable.

The repository contains a Dockerfile at `backend/Dockerfile`. In the Render service settings, verify:

| Setting | Expected value |
| --- | --- |
| Runtime | Docker |
| Repository | `christian-official/schoolbridge-ug` |
| Branch | `feature/student-staff-finance` while this work is reviewed |
| Dockerfile path | `backend/Dockerfile` |
| Health check path | `/api/health` |

The Dockerfile installs the backend requirements and starts Uvicorn on port `8001`; do not add a conflicting start command or change the port without changing and testing the Dockerfile.

Check these Render environment variables:

| Variable | Required configuration |
| --- | --- |
| `SCHOOLBRIDGE_DATABASE_URL` | Existing private Neon pooled URL, using `postgresql+psycopg://` |
| `SCHOOLBRIDGE_SECRET_KEY` | A long, randomly generated private secret; never reuse a public, CI, or development secret |
| `SCHOOLBRIDGE_CORS_ORIGINS` | Exact Render Static Site origin, with no path and no trailing slash |
| `SCHOOLBRIDGE_ALLOWED_HOSTS` | Render API hostname only, without scheme or path, if the trusted-host allow-list is enabled |
| `SCHOOLBRIDGE_SEED_DEMO_DATA` | `false` for the existing database |

The API parses `SCHOOLBRIDGE_CORS_ORIGINS` as a comma-separated list. For this preview, allow only the exact frontend origin. Do not use a wildcard. Do not paste secret values into GitHub or share them in chat. Leave demo seeding off for the existing database.

After deployment, open the Render API service's HTTPS URL followed by `/api/health`. A healthy response should report `status: ok` and a connected database. If it reports a database error, stop and correct the private database configuration before proceeding.

## 3. Create the Render frontend Static Site

In the Render dashboard choose **New > Static Site**, connect the existing GitHub repository, and configure a separate frontend service. Do not create another Web Service or another database.

| Setting | Value |
| --- | --- |
| Name | `schoolbridge-frontend` (or another available name) |
| Repository | `christian-official/schoolbridge-ug` |
| Branch | `feature/student-staff-finance` while this work is reviewed |
| Root Directory | `frontend` |
| Build Command | `npm ci && npm run build` |
| Publish Directory | `dist` |
| Build environment variable | `VITE_API_BASE_URL` = the existing Render API origin |

The frontend is a Vite/React app. Its build script runs TypeScript checking and Vite, and writes the static site to `dist`. Vite reads `VITE_API_BASE_URL` at build time; it is public configuration, not a secret. Set it to the existing Render API HTTPS origin only, without an API path or trailing slash. Example shape: `https://your-api-service.onrender.com`, using the actual hostname shown in the Render dashboard.

Vite 8 requires a supported modern Node version. If Render's detected Node version is too old, set the static site's `NODE_VERSION` build environment variable to `22.12.0` or a newer supported Node 22 release, then redeploy.

After the first successful deploy, copy the exact Static Site HTTPS origin shown by Render (for example, `https://schoolbridge-frontend.onrender.com`). Add that exact origin to the API's `SCHOOLBRIDGE_CORS_ORIGINS` variable. If other trusted preview origins are deliberately needed, list each exact origin separated by commas. Save the API environment change and redeploy the API.

The SchoolBridge entry point and QR destination use the site root with a `?school=` query parameter. If additional client-side paths are introduced, configure a Render rewrite from `/*` to `/index.html` so refreshes return the SPA shell. Do not add a rewrite that intercepts API requests on the separate API hostname.

## 4. Verify the hosted school-access journey

Use fictional preview data only.

1. Confirm the Render API `/api/health` endpoint reports a connected PostgreSQL database.
2. Open the Render Static Site HTTPS origin and confirm the frontend loads.
3. Confirm browser requests reach the existing Render API without CORS or host-validation errors.
4. From the school admin's registered-device area, generate the school QR code. Scan it with a phone on a separate internet connection (not the school Wi-Fi) and confirm it opens the correct school-specific hosted URL.
5. Confirm the school identity resolves and the public registration/login journey loads for that school.
6. Test PWA installation and reload the installed app. Confirm the app shell opens offline. Do not interpret offline shell access as proof that online API data or pending school records are synchronised offline.

If a step fails, record the failing URL, status, and non-sensitive error message. Never share access tokens, passwords, database URLs, or verification codes.

## Preview limits and production boundary

- Render Static Sites are free to deploy and served through Render's CDN with managed HTTPS. They count against workspace bandwidth and build-pipeline allowances; check the dashboard for current usage.
- The existing free Render Web Service may spin down after inactivity, causing a cold start, and its local filesystem is not durable. Do not store the hosted database on Render's local disk.
- Neon Free has usage and storage limits and may scale database compute to zero after inactivity. Check the current Neon dashboard for the project's actual usage and limits.
- The static frontend does not run the Python API; the existing Render Web Service remains responsible for API requests.
- Free hosting is suitable only for controlled demonstrations and integration checks. It does not provide production uptime, capacity, or support guarantees. Do not use it for real school records.
- Before any real-school rollout, use appropriately sized durable services, tested backups and restore procedures, monitoring, access controls, and a data-protection review.
- The school desktop/USB installation remains local-first and must continue operating without internet. The hosted preview is not a replacement for the local installation.

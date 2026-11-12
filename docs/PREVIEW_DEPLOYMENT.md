# SchoolBridge shared browser preview

This is a controlled preview deployment for hosted PWA delivery, school QR onboarding, and remote-access integration testing. It is separate from each school's offline Windows installation. **Use fictional test records only; do not enter real student, parent, staff, financial, or other personal information.**

## Shared hosting design

One shared hosted application serves multiple schools. Each school uses its own public QR identity and tenant-scoped records.

- **Cloudflare Pages** serves the Vite frontend over HTTPS.
- **Render** runs the FastAPI backend using the repository's `backend/Dockerfile`.
- **The existing Neon project** provides the hosted PostgreSQL database. Reuse the database already created for the `schoolbridge-ug` Render service; do not create another Neon project for this deployment.
- **The local school installation** continues to use its own local database and must remain usable without internet access.

The hosted API and Neon database support remote access. They do not, by themselves, synchronise a school's local SQLite database with Neon. Do not assume local records are mirrored to the hosted database; only use a separately implemented and tested synchronisation workflow for that purpose.

## 1. Check the existing Neon connection

1. Open the existing Neon project and use its PostgreSQL connection details. Do not create a replacement project.
2. Use the pooled connection string for the hosted Render service. Keep it private; never put it in Git, a frontend variable, a screenshot, or a message.
3. SchoolBridge uses SQLAlchemy with Psycopg 3. The connection URL supplied to `SCHOOLBRIDGE_DATABASE_URL` must use the `postgresql+psycopg://` scheme and retain Neon’s required TLS query parameters (normally `sslmode=require`).
4. Confirm that the existing Render service has the connection string stored as the private environment variable `SCHOOLBRIDGE_DATABASE_URL`. If it is already configured and healthy, do not replace it.
5. SchoolBridge runs its pending database migrations during backend startup. Keep a verified backup before deploying schema changes.

## 2. Configure the Render API service

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
| `SCHOOLBRIDGE_CORS_ORIGINS` | Exact Cloudflare Pages origin, with no path and no trailing slash |
| `SCHOOLBRIDGE_ALLOWED_HOSTS` | Render API hostname only, without scheme or path, if the trusted-host allow-list is enabled |
| `SCHOOLBRIDGE_SEED_DEMO_DATA` | `false` for the existing database |

Do not paste secret values into GitHub or share them in chat. The application defaults demo seeding to off; leave it off for the existing database.

After deployment, open the Render service's HTTPS URL followed by `/api/health`. A healthy response should report `status: ok` and a connected database. If it reports a database error, stop and correct the private database configuration before proceeding.

## 3. Configure Cloudflare Pages

Use the existing Cloudflare Pages project if one has already been created for this preview. Configure it as follows:

| Setting | Value |
| --- | --- |
| Production branch | `feature/student-staff-finance` while this work is reviewed |
| Root directory | `frontend` |
| Build command | `npm ci && npm run build` |
| Build output directory | `dist` |
| Build environment variable | `VITE_API_BASE_URL` = the Render API origin |

Set `VITE_API_BASE_URL` to the Render service's HTTPS origin only, without an API path or trailing slash. For example, use `https://your-service.onrender.com` with the actual hostname shown in the Render dashboard.

Copy the exact deployed Cloudflare Pages origin (for example, `https://your-project.pages.dev`) and set that exact origin in Render's `SCHOOLBRIDGE_CORS_ORIGINS`. Redeploy the API after changing the CORS value. CORS must not be configured as a wildcard for the public preview.

The API hostname in `SCHOOLBRIDGE_ALLOWED_HOSTS` must match the actual Render hostname. Do not include `https://`, a path, or a wildcard. If changing this setting causes the health endpoint to reject requests, correct the hostname to the exact service hostname.

## 4. Verify the hosted school-access journey

Use fictional preview data only.

1. Confirm the Render `/api/health` endpoint reports a connected PostgreSQL database.
2. Open the Cloudflare Pages HTTPS origin and confirm the frontend loads.
3. Confirm browser requests reach the Render API without CORS or host-validation errors.
4. From the school admin's registered-device area, generate the school QR code. Scan it with a phone on a separate internet connection (not the school Wi-Fi) and confirm it opens the correct school-specific hosted URL.
5. Confirm the school identity resolves and the public registration/login journey loads for that school.
6. Test PWA installation and reload the installed app. Confirm the app shell opens offline. Do not interpret offline shell access as proof that online API data or pending school records are synchronised offline.

If a step fails, record the failing URL, status, and non-sensitive error message. Never share access tokens, passwords, database URLs, or verification codes.

## Preview limits and production boundary

- Render's free service may spin down after inactivity, causing a cold start, and its local filesystem is not durable. Do not store the hosted database on Render's local disk.
- Neon Free has usage and storage limits and may scale database compute to zero after inactivity. Check the current Neon dashboard for the project's actual usage and limits.
- Cloudflare Pages hosts the static frontend; it does not run the Python API.
- Free hosting is suitable only for controlled demonstrations and integration checks. It does not provide production uptime, capacity, or support guarantees. Do not use it for real school records.
- Before any real-school rollout, use appropriately sized durable services, tested backups and restore procedures, monitoring, access controls, and a data-protection review.
- The school desktop/USB installation remains local-first and must continue operating without internet. The hosted preview is not a replacement for the local installation.

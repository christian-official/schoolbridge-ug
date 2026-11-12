# SchoolBridge shared browser preview

This is a temporary preview deployment for interface, QR onboarding, and integration testing. It is separate from each school's offline Windows installation. **Use fictional test records only; do not enter real student, parent, staff, financial, or other personal information.**

## Shared hosting design

One shared web application serves every school. Each school uses its own school QR identity and tenant-scoped records inside the same application. Do not create a separate deployment, paid domain, tunnel, or database for each school.

The preview uses:
- **Cloudflare Pages** for the Vite frontend, with its HTTPS `.pages.dev` address.
- **Koyeb** for the FastAPI service, with its HTTPS `.koyeb.app` address.
- **Neon** for PostgreSQL persistence. The database is shared by the application, while SchoolBridge enforces school-level tenant separation.

The frontend's `VITE_API_BASE_URL` points to the one shared Koyeb API. The API's `SCHOOLBRIDGE_CORS_ORIGINS` must contain the exact Cloudflare Pages origin, not a wildcard.

## 1. Create the shared PostgreSQL database

1. Create a PostgreSQL project in Neon.
2. Choose a region close to the Koyeb service region (Frankfurt is a suitable pairing for the free preview regions).
3. Copy the pooled connection string from the Neon dashboard and keep it private.
4. Convert the URL scheme to `postgresql+psycopg://` so SQLAlchemy uses the project's installed Psycopg 3 driver. Retain the host, database, credentials, and required TLS query parameters such as `sslmode=require`.
5. Do not commit the connection string to Git or place it in frontend variables.

## 2. Deploy the API on Koyeb

1. Create a Web Service and connect the `christian-official/schoolbridge-ug` GitHub repository.
2. Select branch `feature/student-staff-finance`.
3. Select the Python buildpack and set the working directory / root directory to `backend`.
4. Set the run command to:

   ```sh
   uvicorn app.main:app --host 0.0.0.0 --port 8001
   ```

5. Expose port `8001` as an HTTP service port.
6. Configure these environment variables in the Koyeb dashboard:

   | Variable | Value |
   | --- | --- |
   | `SCHOOLBRIDGE_DATABASE_URL` | The private Neon pooled PostgreSQL URL using `postgresql+psycopg://` |
   | `SCHOOLBRIDGE_SECRET_KEY` | A newly generated, long random secret; never reuse a CI or local-development secret |
   | `SCHOOLBRIDGE_LICENSE_PUBLIC_KEY` | The owner's base64 public verification key; never upload the private signing key |
   | `SCHOOLBRIDGE_CORS_ORIGINS` | The exact Pages origin after step 3, e.g. `https://schoolbridge-preview.pages.dev` |
   | `SCHOOLBRIDGE_SEED_DEMO_DATA` | `false` |

7. Wait for the generated `.koyeb.app` service URL to become healthy at `/api/health`. Keep the service URL; it is the one shared API origin.

## 3. Deploy the frontend on Cloudflare Pages

1. In Cloudflare Pages, create a project connected to the same GitHub repository.
2. Set the production branch to `feature/student-staff-finance` while this work is being reviewed.
3. Set the project build configuration:

   | Setting | Value |
   | --- | --- |
   | Root directory | `frontend` |
   | Build command | `npm ci && npm run build` |
   | Build output directory | `dist` |

4. Add the build environment variable `VITE_API_BASE_URL` with the Koyeb API origin, e.g. `https://schoolbridge-preview-api.koyeb.app` (no trailing slash).
5. Deploy and copy the exact HTTPS Pages origin, e.g. `https://schoolbridge-preview.pages.dev`.
6. Return to Koyeb and set `SCHOOLBRIDGE_CORS_ORIGINS` to that exact origin. Redeploy the API.
7. Confirm the browser loads the frontend and calls the Koyeb API successfully. QR registration, claim status, verification, and account completion must all use this same API origin.

## Preview limits and production boundary

- Koyeb's free Web Service is a small preview instance, scales down after inactivity, and does not include persistent service volumes. Do not store the database on its local disk.
- Neon Free includes 1 GB database storage and 100 compute-hours per project per month; the compute can scale to zero. The free quota can be exhausted and suspend database compute until the allowance resets or the project is upgraded.
- Cloudflare Pages provides the static HTTPS frontend; it does not host the Python API.
- These free tiers are suitable only for a low-traffic demonstration and integration checks. They do not provide production uptime, capacity, or support guarantees.
- Before any real school data or production rollout, move the API and database to appropriately sized, durable services with tested backups, restore procedures, monitoring, and a data-protection review. Keep one shared application origin; do not create per-school paid domains or tunnels.
- The school desktop/USB installation remains local-first and must continue to work without internet. This hosted preview is not a replacement for it.

# SchoolBridge browser preview

This preview deployment is for interface review only. It is not the offline school installation and must not contain real student or staff information.

## 1. Deploy the API on Render

1. Sign in to Render and choose **New > Blueprint**.
2. Connect the `christian-official/schoolbridge-ug` GitHub repository.
3. Select branch `feature/student-staff-finance`.
4. Render detects the root `render.yaml`. Create the `schoolbridge-preview-api` service.
5. Wait for the service health check at `/api/health` to pass. Render generates `SCHOOLBRIDGE_SECRET_KEY`; do not share it.

The free preview service uses temporary local SQLite storage. Its data may be lost when the service restarts or is redeployed. Use fictional test records only.

## 2. Deploy the frontend on Vercel

1. Import the same GitHub repository into Vercel.
2. Select branch `feature/student-staff-finance`.
3. Set **Root Directory** to `frontend`.
4. Add environment variable `VITE_API_BASE_URL` with the deployed Render service's base URL, for example `https://schoolbridge-preview-api.onrender.com` (no trailing slash).
5. Deploy.

## 3. Connect CORS

After Vercel gives the frontend its URL, open the Render service's environment settings and change `SCHOOLBRIDGE_CORS_ORIGINS` from `*` to the exact Vercel origin, such as `https://schoolbridge-preview.vercel.app`. Redeploy the API.

## Preview limitations

- This is a temporary hosted review environment, not the offline-first school deployment.
- The Render free service may sleep when idle, so its first request can be slow.
- SQLite storage on the free service is ephemeral.
- Do not enter real personal, student, financial, or staff data.
- The API currently requires an administrator account to be provisioned before login. Do not assume a default login exists.

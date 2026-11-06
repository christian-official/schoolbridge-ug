from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="SchoolBridge API",
    description="Offline-first school management system API.",
    version="0.1.0",
)

# Development-only origins. Production origins will be restricted in deployment.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["*"],
)


@app.get("/api/health", tags=["System"])
def health_check() -> dict[str, str]:
    return {"status": "ok", "application": "SchoolBridge", "version": "0.1.0"}


@app.get("/", include_in_schema=False)
def root() -> dict[str, str]:
    return {"message": "SchoolBridge API is running. Visit /docs for API documentation."}

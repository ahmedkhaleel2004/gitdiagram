# backend/app/main.py
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.routers import generate, modify
from app.routers import readme_update_router # <<< ADD THIS IMPORT
from app.core.limiter import limiter
from typing import cast
from starlette.exceptions import ExceptionMiddleware # Ensure this is imported if not already
from api_analytics.fastapi import Analytics # Assuming you still use this
import os


app = FastAPI(
    # title="GitDiagram API", # Optional: Add title, version, etc.
    # version="1.0.0"
)


origins = [
    "http://localhost:3000", # For local frontend development
    "https://gitdiagram.com"  # Your production frontend
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST"], # Adjust if other methods are needed globally
    allow_headers=["*"],
)

API_ANALYTICS_KEY = os.getenv("API_ANALYTICS_KEY")
if API_ANALYTICS_KEY:
    app.add_middleware(Analytics, api_key=API_ANALYTICS_KEY)

app.state.limiter = limiter
app.add_exception_handler(
    RateLimitExceeded, cast(ExceptionMiddleware, _rate_limit_exceeded_handler)
)

# Include your existing routers
app.include_router(generate.router)
app.include_router(modify.router)

# Include the new router for README updates
app.include_router(readme_update_router.router) # <<< ADD THIS LINE

@app.get("/")
@limiter.limit("100/day") # Your existing rate limit comment
async def root(request: Request):
    return {"message": "Hello from GitDiagram API! Now with README update capabilities."}

# If you have other specific startup events or configurations, they would go here
# @app.on_event("startup")
# async def startup_event():
#     print("Application startup...")

# @app.on_event("shutdown")
# def shutdown_event():
#     print("Application shutdown.")
# backend/app/routers/readme_update_router.py
import os
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from app.utils.readme_updater import update_readme_with_new_diagram

router = APIRouter(
    prefix="/internal",
    tags=["internal-readme-updates"],
)

async def verify_internal_token(x_internal_token: str = Header(None)):
    expected_token = os.getenv("GITDIAGRAM_INTERNAL_SECRET_TOKEN")
    if not expected_token:
        print("CRITICAL: GITDIAGRAM_INTERNAL_SECRET_TOKEN is not configured on the server.")
        raise HTTPException(status_code=500, detail="Internal server configuration error.")
    if not x_internal_token or x_internal_token != expected_token:
        print(f"Access denied: Invalid or missing internal token. Expected: '{expected_token[:5]}...' Received: '{x_internal_token[:5] if x_internal_token else 'None'}...'") # Log snippet for debug
        raise HTTPException(status_code=403, detail="Access denied: Invalid or missing internal token.")
    print("Internal token verified successfully.")
    return True

class ReadmeUpdateRequest(BaseModel):
    repo_full_name: str 
    branch_name: str    

@router.post("/update-readme-diagram", dependencies=[Depends(verify_internal_token)])
async def trigger_readme_diagram_update(request_data: ReadmeUpdateRequest):
    llm_api_key_env = os.getenv("OPENAI_API_KEY") # Still needed for the LLM service

    # GITHUB_PAT_FOR_README_UPDATES and GITHUB_PAT_FOR_REPO_READ are no longer directly used here,
    # as GitHubService will use App Auth or fallback to GITHUB_PAT from .env.
    
    if not llm_api_key_env:
        print("CRITICAL: OPENAI_API_KEY is not set for internal diagram generation.")
        raise HTTPException(status_code=500, detail="Server config error: Missing LLM API key.")

    print(f"Router: Received request to update README for {request_data.repo_full_name} on branch {request_data.branch_name}")
    
    success = await update_readme_with_new_diagram(
        repo_full_name=request_data.repo_full_name,
        branch_to_commit_to=request_data.branch_name,
        llm_api_key=llm_api_key_env
        # No explicit PATs passed here; GitHubService handles its auth.
    )

    if success:
        return {"status": "ok", "message": f"README update process for {request_data.repo_full_name} on branch {request_data.branch_name} initiated."}
    else:
        # readme_updater should have logged specific errors
        print(f"Router: README update process for {request_data.repo_full_name} on branch {request_data.branch_name} failed overall.")
        raise HTTPException(status_code=500, detail=f"Failed to update README for {request_data.repo_full_name}. Check server logs.")
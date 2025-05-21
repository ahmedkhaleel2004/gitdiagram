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
        print(f"Access denied: Invalid or missing internal token.")
        raise HTTPException(status_code=403, detail="Access denied: Invalid or missing internal token.")
    return True

class ReadmeUpdateRequest(BaseModel):
    repo_full_name: str # e.g., "owner/repo"
    branch_name: str    # e.g., "main" or "master" - to be provided by the calling script

@router.post("/update-readme-diagram", dependencies=[Depends(verify_internal_token)])
async def trigger_readme_diagram_update(request_data: ReadmeUpdateRequest):
    github_pat_for_readme_updates = os.getenv("GITHUB_PAT_FOR_README_UPDATES")
    llm_api_key_env = os.getenv("OPENAI_API_KEY")
    github_pat_for_repo_read = os.getenv("GITHUB_PAT") # PAT backend uses to read general repo info

    if not github_pat_for_readme_updates:
        # ... (error handling as in your snapshot) ...
        print("CRITICAL: GITHUB_PAT_FOR_README_UPDATES is not set.")
        raise HTTPException(status_code=500, detail="Server config error: Missing PAT for README updates.")
    if not llm_api_key_env:
        # ... (error handling as in your snapshot) ...
        print("CRITICAL: OPENAI_API_KEY is not set for internal diagram generation.")
        raise HTTPException(status_code=500, detail="Server config error: Missing LLM API key.")

    print(f"Received request to update README for {request_data.repo_full_name} on branch {request_data.branch_name}")
    success = await update_readme_with_new_diagram(
        repo_full_name=request_data.repo_full_name,
        branch_to_commit_to=request_data.branch_name, # Pass the branch from request
        github_pat_for_updates=github_pat_for_readme_updates,
        llm_api_key=llm_api_key_env,
        github_pat_for_repo_read=github_pat_for_repo_read
    )

    if success:
        return {"status": "ok", "message": f"README update process for {request_data.repo_full_name} on branch {request_data.branch_name} initiated."}
    else:
        print(f"README update process for {request_data.repo_full_name} on branch {request_data.branch_name} failed.")
        raise HTTPException(status_code=500, detail=f"Failed to update README for {request_data.repo_full_name}. Check server logs.")
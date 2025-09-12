from fastapi import APIRouter, Request, HTTPException
from dotenv import load_dotenv

# from app.services.claude_service import ClaudeService
# from app.core.limiter import limiter
from anthropic._exceptions import RateLimitError
from app.prompts import SYSTEM_MODIFY_PROMPT
from pydantic import BaseModel
from app.services.gpt_5_mini_openai_service import OpenAIgpt5Service


load_dotenv()

router = APIRouter(prefix="/modify", tags=["OpenAI gpt-5-mini"])

# Initialize services
# claude_service = ClaudeService()
gpt5_service = OpenAIgpt5Service()


# Define the request body model


class ModifyRequest(BaseModel):
    instructions: str
    current_diagram: str
    repo: str
    username: str
    explanation: str


@router.post("")
# @limiter.limit("2/minute;10/day")
async def modify(request: Request, body: ModifyRequest):
    try:
        print(
            f"[MODIFY] Request user={body.username} repo={body.repo} instructions_len={len(body.instructions)}",
            flush=True,
        )
        # Check instructions length
        if not body.instructions or not body.current_diagram:
            return {"error": "Instructions and/or current diagram are required"}
        elif (
            len(body.instructions) > 1000 or len(body.current_diagram) > 100000
        ):  # just being safe
            return {"error": "Instructions exceed maximum length of 1000 characters"}

        # Allow modifications for all repositories

        # modified_mermaid_code = claude_service.call_claude_api(
        #     system_prompt=SYSTEM_MODIFY_PROMPT,
        #     data={
        #         "instructions": body.instructions,
        #         "explanation": body.explanation,
        #         "diagram": body.current_diagram,
        #     },
        # )

        print(
            f"[MODIFY] Calling model. current_diagram_chars={len(body.current_diagram)} explanation_chars={len(body.explanation)}",
            flush=True,
        )
        modified_mermaid_code = gpt5_service.call_gpt5_api(
            system_prompt=SYSTEM_MODIFY_PROMPT,
            data={
                "instructions": body.instructions,
                "explanation": body.explanation,
                "diagram": body.current_diagram,
            },
        )
        print(
            f"[MODIFY] Model response received. modified_diagram_chars={len(modified_mermaid_code)}",
            flush=True,
        )

        # Check for BAD_INSTRUCTIONS response
        if "BAD_INSTRUCTIONS" in modified_mermaid_code:
            return {"error": "Invalid or unclear instructions provided"}

        return {"diagram": modified_mermaid_code}
    except RateLimitError as e:
        raise HTTPException(
            status_code=429,
            detail="Service is currently experiencing high demand. Please try again in a few minutes.",
        )
    except Exception as e:
        print(f"[MODIFY][ERROR] {str(e)}", flush=True)
        return {"error": str(e)}

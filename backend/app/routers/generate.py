import json
import asyncio
import re
import logging
from functools import lru_cache
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.services.github_service import GitHubService
from app.services.o4_mini_openai_service import OpenAIo4Service
from app.prompts import (
    SYSTEM_FIRST_PROMPT,
    SYSTEM_SECOND_PROMPT,
    SYSTEM_THIRD_PROMPT,
    ADDITIONAL_SYSTEM_INSTRUCTIONS_PROMPT,
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()

# Initialize services
o4_service = OpenAIo4Service()
github_service = GitHubService()


def safe_json_response(data):
    """
    Safely serialize data to JSON for SSE responses, handling special characters.
    """
    try:
        # Ensure chunk content is properly encoded
        if 'chunk' in data and data['chunk']:
            # The chunk might contain characters that need to be handled carefully
            # json.dumps already handles escaping, but we want to be extra safe
            data['chunk'] = str(data['chunk'])
        return json.dumps(data, ensure_ascii=False)
    except (TypeError, ValueError) as e:
        # Fallback for any JSON serialization issues
        error_data = {'error': f'JSON serialization error: {str(e)}'}
        return json.dumps(error_data)


def advanced_mermaid_validation(mermaid_code: str) -> tuple[bool, list[str]]:
    """
    Perform advanced validation on Mermaid code.
    
    Returns:
        tuple: (is_valid, list_of_warnings)
    """
    warnings = []
    is_valid = True
    
    # Check for graph type consistency
    graph_types = re.findall(r'^(graph|flowchart|sequenceDiagram|classDiagram)', mermaid_code, re.MULTILINE)
    if len(graph_types) > 1:
        warnings.append(f"Multiple graph types found: {graph_types}")
        is_valid = False
    
    # Check for orphaned nodes (nodes that are defined but not connected)
    node_definitions = set(re.findall(r'(\w+)\s*[\[\(]', mermaid_code))
    node_connections = set()
    
    # Find all nodes in connections
    connection_patterns = [
        r'(\w+)\s*-->\s*(\w+)',
        r'(\w+)\s*---\s*(\w+)',
        r'(\w+)\s*-\.\s*(\w+)',
        r'(\w+)\s*==>\s*(\w+)',
        r'(\w+)\s*-\.-\s*(\w+)',
    ]
    
    for pattern in connection_patterns:
        matches = re.findall(pattern, mermaid_code)
        for match in matches:
            node_connections.update(match)
    
    orphaned_nodes = node_definitions - node_connections
    if orphaned_nodes:
        warnings.append(f"Orphaned nodes found (defined but not connected): {orphaned_nodes}")
    
    # Check for undefined nodes (nodes used in connections but not defined)
    undefined_nodes = node_connections - node_definitions
    if undefined_nodes:
        warnings.append(f"Undefined nodes found (used but not defined): {undefined_nodes}")
        is_valid = False
    
    # Check for circular references in simple cases
    connections = []
    for pattern in connection_patterns:
        matches = re.findall(pattern, mermaid_code)
        for match in matches:
            connections.append((match[0], match[1]))
    
    # Simple cycle detection (not comprehensive but catches basic issues)
    for source, target in connections:
        if (target, source) in connections:
            warnings.append(f"Potential circular reference between {source} and {target}")
    
    # Check for reserved keywords being used as node IDs
    reserved_keywords = ['class', 'click', 'end', 'graph', 'flowchart', 'style', 'classDef']
    for keyword in reserved_keywords:
        if re.search(rf'\b{keyword}\b.*[\[\(]', mermaid_code):
            warnings.append(f"Reserved keyword '{keyword}' used as node ID")
            is_valid = False
    
    return is_valid, warnings


def validate_and_sanitize_mermaid(mermaid_code: str, username: str, repo: str) -> str:
    """
    Validate and sanitize Mermaid diagram code to prevent syntax errors.
    
    Args:
        mermaid_code (str): Raw Mermaid code from AI
        username (str): GitHub username for logging context
        repo (str): Repository name for logging context
    
    Returns:
        str: Sanitized Mermaid code
    """
    logger.info(f"\n=== MERMAID CODE VALIDATION FOR {username}/{repo} ===")
    logger.info("Raw Mermaid Code:")
    logger.info("=" * 50)
    logger.info(mermaid_code)
    logger.info("=" * 50)
    
    # Store original for comparison
    original_code = mermaid_code
    issues_found = []
    
    try:
        # Remove any remaining markdown code blocks
        mermaid_code = re.sub(r'```mermaid\s*', '', mermaid_code)
        mermaid_code = re.sub(r'```\s*$', '', mermaid_code)
        
        # Check for common problematic patterns
        if re.search(r'[^\x00-\x7F]', mermaid_code):
            issues_found.append("Non-ASCII characters detected")
            # Remove non-ASCII characters
            mermaid_code = ''.join(char for char in mermaid_code if ord(char) < 128)
        
        # Ensure we have a graph declaration
        if not re.search(r'^(graph|flowchart|sequenceDiagram|classDiagram)', mermaid_code.strip(), re.MULTILINE):
            issues_found.append("No graph declaration found, adding flowchart TD")
            mermaid_code = "flowchart TD\n" + mermaid_code
        
        # Fix invalid node IDs more comprehensively
        def sanitize_node_id(node_id):
            """Sanitize a node ID to be Mermaid-compliant"""
            # Replace invalid characters with underscores
            sanitized = re.sub(r'[^a-zA-Z0-9_-]', '_', node_id)
            # Ensure it starts with a letter or underscore
            if sanitized and not sanitized[0].isalpha() and sanitized[0] != '_':
                sanitized = '_' + sanitized
            # Ensure it's not empty
            if not sanitized:
                sanitized = 'node_' + str(hash(node_id))[:8]
            return sanitized
        
        # Find and fix all node references
        node_pattern = r'\b([A-Z][A-Z0-9_]*)\b'
        nodes_found = set(re.findall(node_pattern, mermaid_code))
        
        for node in nodes_found:
            if re.search(r'[^a-zA-Z0-9_-]', node) or (node and not node[0].isalpha() and node[0] != '_'):
                sanitized_node = sanitize_node_id(node)
                if sanitized_node != node:
                    issues_found.append(f"Fixed invalid node ID: {node} -> {sanitized_node}")
                    mermaid_code = re.sub(rf'\b{re.escape(node)}\b', sanitized_node, mermaid_code)
        
        # Fix arrows and connections - ensure proper spacing and syntax
        arrow_fixes = [
            (r'(\w+)\s*-->\s*(\w+)', r'\1 --> \2'),
            (r'(\w+)\s*---\s*(\w+)', r'\1 --- \2'),
            (r'(\w+)\s*-\.\s*(\w+)', r'\1 -. \2'),
            (r'(\w+)\s*==>\s*(\w+)', r'\1 ==> \2'),
            (r'(\w+)\s*-\.-\s*(\w+)', r'\1 -.- \2'),
        ]
        
        for pattern, replacement in arrow_fixes:
            if re.search(pattern, mermaid_code):
                mermaid_code = re.sub(pattern, replacement, mermaid_code)
                issues_found.append(f"Fixed arrow spacing: {pattern}")
        
        # Fix arrow labels that might cause issues with Mermaid 11.4.1
        # Pattern: Node -->|"label"| Node becomes Node -->|label| Node (remove quotes)
        def fix_arrow_label(match):
            source = match.group(1)
            arrow = match.group(2)
            label = match.group(3)
            target = match.group(4)
            
            # Remove quotes and problematic characters from arrow labels
            clean_label = label.replace('"', '').replace("'", "")
            # Replace problematic characters that might break Mermaid
            clean_label = re.sub(r'[<>{}]', '', clean_label)
            
            return f'{source} {arrow}|{clean_label}| {target}'
        
        # Fix arrow labels with quotes
        arrow_label_pattern = r'(\w+)\s*(-->|---|-\.|==>|-\.-)\s*\|\s*["\']([^"\']*)["\']?\s*\|\s*(\w+)'
        if re.search(arrow_label_pattern, mermaid_code):
            mermaid_code = re.sub(arrow_label_pattern, fix_arrow_label, mermaid_code)
            issues_found.append("Fixed arrow label syntax for Mermaid 11.4.1 compatibility")
        
        # Fix labels - handle various bracket types and escape content
        def fix_label(match):
            full_match = match.group(0)
            node_id = match.group(1) if match.lastindex >= 1 else ''
            bracket_open = match.group(2) if match.lastindex >= 2 else ''
            label_content = match.group(3) if match.lastindex >= 3 else ''
            bracket_close = match.group(4) if match.lastindex >= 4 else ''
            
            # Escape problematic characters in labels
            escaped_label = label_content.replace('"', '&quot;').replace("'", '&#39;')
            escaped_label = re.sub(r'[<>{}]', '', escaped_label)  # Remove HTML-like tags
            escaped_label = re.sub(r'[\r\n\t]', ' ', escaped_label)  # Replace newlines/tabs with spaces
            
            return f'{node_id}{bracket_open}"{escaped_label}"{bracket_close}'
        
        # Fix different label patterns
        label_patterns = [
            r'(\w+)\s*([\[\(])\s*([^"\]\)]+)\s*([\]\)])',  # NodeID[label] or NodeID(label)
            r'(\w+)\s*([\[\(])"([^"]*)"\s*([\]\)])',       # NodeID["label"] or NodeID("label") 
        ]
        
        for pattern in label_patterns:
            if re.search(pattern, mermaid_code):
                mermaid_code = re.sub(pattern, fix_label, mermaid_code)
                issues_found.append(f"Fixed label format: {pattern}")
        
        # Remove multiple consecutive empty lines
        mermaid_code = re.sub(r'\n\s*\n\s*\n+', '\n\n', mermaid_code)
        
        # Ensure proper indentation (4 spaces for flowchart elements)
        lines = mermaid_code.split('\n')
        processed_lines = []
        
        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue
                
            # Graph declaration lines don't need indentation
            if re.match(r'^(graph|flowchart|sequenceDiagram|classDiagram)', stripped):
                processed_lines.append(stripped)
            else:
                # Add indentation for content lines
                if not stripped.startswith('    '):
                    processed_lines.append('    ' + stripped)
                else:
                    processed_lines.append(stripped)
        
        mermaid_code = '\n'.join(processed_lines)
        
        # Validate basic structure
        if not mermaid_code.strip():
            issues_found.append("ERROR: Empty Mermaid code after sanitization")
            return "flowchart TD\n    A[Error: Empty diagram generated]"
        
        # Check for syntax issues
        open_brackets = mermaid_code.count('[') - mermaid_code.count(']')
        open_parens = mermaid_code.count('(') - mermaid_code.count(')')
        open_quotes = mermaid_code.count('"') % 2
        
        if open_brackets != 0:
            issues_found.append(f"WARNING: Unbalanced square brackets (difference: {open_brackets})")
        if open_parens != 0:
            issues_found.append(f"WARNING: Unbalanced parentheses (difference: {open_parens})")
        if open_quotes != 0:
            issues_found.append(f"WARNING: Unbalanced quotes")
        
        # Run advanced validation
        is_advanced_valid, advanced_warnings = advanced_mermaid_validation(mermaid_code)
        if not is_advanced_valid:
            issues_found.append("CRITICAL: Advanced validation failed")
        
        issues_found.extend([f"ADVANCED: {warning}" for warning in advanced_warnings])
        
        # Log all issues found
        if issues_found:
            logger.info("\nIssues found and fixed:")
            for issue in issues_found:
                logger.info(f"  - {issue}")
        
        # Log the sanitized result
        if original_code != mermaid_code:
            logger.info("\nSanitized Mermaid Code:")
            logger.info("=" * 50)
            logger.info(mermaid_code)
            logger.info("=" * 50)
            logger.info(f"Total fixes applied: {len(issues_found)}")
        else:
            logger.info("No sanitization changes needed")
        
        return mermaid_code
        
    except Exception as e:
        error_msg = str(e)
        logger.error(f"ERROR during Mermaid validation: {error_msg}")
        logger.error("Returning fallback diagram")
        
        fallback_diagram = f"""flowchart TD
    A[Error in diagram generation]
    A --> B[Please try regenerating]
    B --> C[Repository: {username}/{repo}]
    C --> D[Error: {error_msg[:30]}...]"""
        
        return fallback_diagram


# cache github data to avoid double API calls from cost and generate
@lru_cache(maxsize=100)
def get_cached_github_data(username: str, repo: str, github_pat: str | None = None):
    # Create a new service instance for each call with the appropriate PAT
    service = GitHubService(pat=github_pat)
    
    default_branch = service.get_default_branch(username, repo)
    if not default_branch:
        default_branch = "main"  # fallback value

    file_tree = service.get_github_file_paths_as_list(username, repo)
    readme = service.get_github_readme(username, repo)

    return {"default_branch": default_branch, "file_tree": file_tree, "readme": readme}


def get_github_data_with_cache_control(username: str, repo: str, github_pat: str | None = None, clear_cache: bool = False):
    """
    Wrapper function that can bypass cache when requested.
    """
    if clear_cache:
        logger.info(f"🗑️ Cache cleared for {username}/{repo} - fetching fresh data from GitHub")
        # Clear the specific cache entry by calling the cached function with different args
        # Since we can't easily clear specific LRU cache entries, we bypass the cache entirely
        service = GitHubService(pat=github_pat)
        
        default_branch = service.get_default_branch(username, repo)
        if not default_branch:
            default_branch = "main"  # fallback value

        file_tree = service.get_github_file_paths_as_list(username, repo)
        readme = service.get_github_readme(username, repo)

        result = {"default_branch": default_branch, "file_tree": file_tree, "readme": readme}
        
        # Now update the cache with fresh data by calling the cached function
        # This will overwrite the old cached entry
        try:
            get_cached_github_data.cache_clear()  # Clear entire cache
            get_cached_github_data(username, repo, github_pat)  # Repopulate with fresh data
            logger.info(f"✅ Cache updated with fresh data for {username}/{repo}")
        except Exception as e:
            logger.warning(f"Cache update failed: {e}")
        
        return result
    else:
        logger.info(f"📋 Using cached data for {username}/{repo}")
        return get_cached_github_data(username, repo, github_pat)


class ApiRequest(BaseModel):
    username: str
    repo: str
    instructions: str = ""
    api_key: str | None = None
    github_pat: str | None = None
    clear_cache: bool = False


@router.post("/cost")
# @limiter.limit("5/minute") # TEMP: disable rate limit for growth??
async def get_generation_cost(request: Request, body: ApiRequest):
    try:
        # Get file tree and README content
        github_data = get_github_data_with_cache_control(body.username, body.repo, body.github_pat, body.clear_cache)
        file_tree = github_data["file_tree"]
        readme = github_data["readme"]

        # Calculate combined token count
        # file_tree_tokens = claude_service.count_tokens(file_tree)
        # readme_tokens = claude_service.count_tokens(readme)

        file_tree_tokens = o4_service.count_tokens(file_tree)
        readme_tokens = o4_service.count_tokens(readme)

        # CLAUDE: Calculate approximate cost
        # Input cost: $3 per 1M tokens ($0.000003 per token)
        # Output cost: $15 per 1M tokens ($0.000015 per token)
        # input_cost = ((file_tree_tokens * 2 + readme_tokens) + 3000) * 0.000003
        # output_cost = 3500 * 0.000015
        # estimated_cost = input_cost + output_cost

        # Input cost: $1.1 per 1M tokens ($0.0000011 per token)
        # Output cost: $4.4 per 1M tokens ($0.0000044 per token)
        input_cost = ((file_tree_tokens * 2 + readme_tokens) + 3000) * 0.0000011
        output_cost = (
            8000 * 0.0000044
        )  # 8k just based on what I've seen (reasoning is expensive)
        estimated_cost = input_cost + output_cost

        # Format as currency string
        cost_string = f"${estimated_cost:.2f} USD"
        return {"cost": cost_string}
    except ValueError as ve:
        # Handle specific GitHub API errors (like rate limits, private repos, etc.)
        error_message = str(ve)
        logger.error(f"GitHub API error in cost estimation: {error_message}")
        return {"error": error_message}
    except Exception as e:
        # Handle any other unexpected errors
        error_message = f"Failed to calculate cost: {str(e)}"
        logger.error(f"Unexpected error in cost estimation: {error_message}")
        return {"error": error_message}


def process_click_events(diagram: str, username: str, repo: str, branch: str) -> str:
    """
    Process click events in Mermaid diagram to include full GitHub URLs.
    Detects if path is file or directory and uses appropriate URL format.
    """

    def replace_path(match):
        # Extract the path from the click event
        path = match.group(2).strip("\"'")

        # Determine if path is likely a file (has extension) or directory
        is_file = "." in path.split("/")[-1]

        # Construct GitHub URL
        base_url = f"https://github.com/{username}/{repo}"
        path_type = "blob" if is_file else "tree"
        full_url = f"{base_url}/{path_type}/{branch}/{path}"

        # Return the full click event with the new URL
        return f'click {match.group(1)} "{full_url}"'

    # Match click events: click ComponentName "path/to/something"
    click_pattern = r'click ([^\s"]+)\s+"([^"]+)"'
    return re.sub(click_pattern, replace_path, diagram)


@router.post("/stream")
async def generate_stream(request: Request, body: ApiRequest):
    try:
        # Initial validation checks
        if len(body.instructions) > 1000:
            return {"error": "Instructions exceed maximum length of 1000 characters"}

        if body.repo in [
            "fastapi",
            "streamlit",
            "flask",
            "api-analytics",
            "monkeytype",
        ]:
            return {"error": "Example repos cannot be regenerated"}

        async def event_generator():
            try:
                # Get cached github data
                github_data = get_github_data_with_cache_control(
                    body.username, body.repo, body.github_pat, body.clear_cache
                )
                default_branch = github_data["default_branch"]
                file_tree = github_data["file_tree"]
                readme = github_data["readme"]

                # Send initial status
                yield f"data: {safe_json_response({'status': 'started', 'message': 'Starting generation process...'})}\n\n"
                await asyncio.sleep(0.1)

                # Token count check
                combined_content = f"{file_tree}\n{readme}"
                token_count = o4_service.count_tokens(combined_content)

                if 50000 < token_count < 195000 and not body.api_key:
                    error_msg = f"File tree and README combined exceeds token limit (50,000). Current size: {token_count} tokens. This GitHub repository is too large for my wallet, but you can continue by providing your own OpenAI API key."
                    yield f"data: {safe_json_response({'error': error_msg})}\n\n"
                    return
                elif token_count > 195000:
                    error_msg = f"Repository is too large (>195k tokens) for analysis. OpenAI o4-mini max context length is 200k tokens. Current size: {token_count} tokens."
                    yield f"data: {safe_json_response({'error': error_msg})}\n\n"
                    return

                # Prepare prompts
                first_system_prompt = SYSTEM_FIRST_PROMPT
                third_system_prompt = SYSTEM_THIRD_PROMPT
                if body.instructions:
                    first_system_prompt = (
                        first_system_prompt
                        + "\n"
                        + ADDITIONAL_SYSTEM_INSTRUCTIONS_PROMPT
                    )
                    third_system_prompt = (
                        third_system_prompt
                        + "\n"
                        + ADDITIONAL_SYSTEM_INSTRUCTIONS_PROMPT
                    )

                # Phase 1: Get explanation
                yield f"data: {safe_json_response({'status': 'explanation_sent', 'message': 'Sending explanation request to o4-mini...'})}\n\n"
                await asyncio.sleep(0.1)
                yield f"data: {safe_json_response({'status': 'explanation', 'message': 'Analyzing repository structure...'})}\n\n"
                explanation = ""
                async for chunk in o4_service.call_o4_api_stream(
                    system_prompt=first_system_prompt,
                    data={
                        "file_tree": file_tree,
                        "readme": readme,
                        "instructions": body.instructions,
                    },
                    api_key=body.api_key,
                    reasoning_effort="medium",
                ):
                    explanation += chunk
                    yield f"data: {safe_json_response({'status': 'explanation_chunk', 'chunk': chunk})}\n\n"

                if "BAD_INSTRUCTIONS" in explanation:
                    yield f"data: {safe_json_response({'error': 'Invalid or unclear instructions provided'})}\n\n"
                    return

                # Phase 2: Get component mapping
                yield f"data: {safe_json_response({'status': 'mapping_sent', 'message': 'Sending component mapping request to o4-mini...'})}\n\n"
                await asyncio.sleep(0.1)
                yield f"data: {safe_json_response({'status': 'mapping', 'message': 'Creating component mapping...'})}\n\n"
                full_second_response = ""
                async for chunk in o4_service.call_o4_api_stream(
                    system_prompt=SYSTEM_SECOND_PROMPT,
                    data={"explanation": explanation, "file_tree": file_tree},
                    api_key=body.api_key,
                    reasoning_effort="low",
                ):
                    full_second_response += chunk
                    yield f"data: {safe_json_response({'status': 'mapping_chunk', 'chunk': chunk})}\n\n"

                # i dont think i need this anymore? but keep it here for now
                # Extract component mapping
                start_tag = "<component_mapping>"
                end_tag = "</component_mapping>"
                component_mapping_text = full_second_response[
                    full_second_response.find(start_tag) : full_second_response.find(
                        end_tag
                    )
                ]

                # Phase 3: Generate Mermaid diagram
                yield f"data: {safe_json_response({'status': 'diagram_sent', 'message': 'Sending diagram generation request to o4-mini...'})}\n\n"
                await asyncio.sleep(0.1)
                yield f"data: {safe_json_response({'status': 'diagram', 'message': 'Generating diagram...'})}\n\n"
                mermaid_code = ""
                async for chunk in o4_service.call_o4_api_stream(
                    system_prompt=third_system_prompt,
                    data={
                        "explanation": explanation,
                        "component_mapping": component_mapping_text,
                        "instructions": body.instructions,
                    },
                    api_key=body.api_key,
                    reasoning_effort="low",
                ):
                    mermaid_code += chunk
                    yield f"data: {safe_json_response({'status': 'diagram_chunk', 'chunk': chunk})}\n\n"

                # Process final diagram
                mermaid_code = mermaid_code.replace("```mermaid", "").replace("```", "")
                if "BAD_INSTRUCTIONS" in mermaid_code:
                    yield f"data: {safe_json_response({'error': 'Invalid or unclear instructions provided'})}\n\n"
                    return

                # Validate and sanitize Mermaid code
                logger.info(f"\n=== PROCESSING DIAGRAM FOR {body.username}/{body.repo} ===")
                mermaid_code = validate_and_sanitize_mermaid(mermaid_code, body.username, body.repo)
                
                # Process click events after validation
                processed_diagram = process_click_events(
                    mermaid_code, body.username, body.repo, default_branch
                )
                
                logger.info(f"\n=== FINAL DIAGRAM WITH CLICK EVENTS FOR {body.username}/{body.repo} ===")
                logger.info("Final Processed Diagram:")
                logger.info("=" * 50)
                logger.info(processed_diagram)
                logger.info("=" * 50)

                # Send final result - avoid sending large content in single JSON to prevent truncation
                # The frontend will use the accumulated chunks instead
                yield f"data: {safe_json_response({
                    'status': 'complete',
                    'message': 'Diagram generation complete'
                })}\n\n"

            except Exception as e:
                yield f"data: {safe_json_response({'error': str(e)})}\n\n"

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "X-Accel-Buffering": "no",  # Hint to Nginx
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        )
    except Exception as e:
        return {"error": str(e)}

import asyncio
import json
import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from power_search.power_search_engine import PowerSearchEngine, FieldType

ps_router = APIRouter()

power_search = PowerSearchEngine()

################
# GET requests #
################

@ps_router.get("/api/power-search/suggestions/{session_id}")
async def get_search_suggestions(session_id: str, prefix: str = ''):
    """
    Get autocomplete suggestions for fields and values
    """
    import main
    main.safe_restore_sessions()

    if session_id not in main.analysis_sessions:
        return []

    suggestions = []

    # Suggest fields
    for field in power_search.common_fields:
        if prefix.lower() in field.lower():
            suggestions.append({
                'type': 'field',
                'value': field,
                'display': f"{field}:",
                'description': f"Filter by {field}"
            })

    # Suggest operators after field
    if ':' in prefix or '=' in prefix:
        field_part = prefix.split(':')[0].split('=')[0].strip()
        if field_part in power_search.field_types:
            field_type = power_search.field_types[field_part]

            if field_type == FieldType.NUMBER:
                operators = ['=', '!=', '>', '>=', '<', '<=']
            else:
                operators = ['=', '!=', '~', '!~']

            for op in operators:
                suggestions.append({
                    'type': 'operator',
                    'value': f"{field_part}{op}",
                    'display': f"{field_part} {op}",
                    'description': f"Compare {field_part}"
                })

    # Suggest values
    field_match = re.match(r'(\w+)[=:~]', prefix)
    if field_match:
        field = field_match.group(1)
        if field in power_search.field_values:
            for value in power_search.field_values[field][:10]:
                suggestions.append({
                    'type': 'value',
                    'value': f'{prefix}{value}',
                    'display': str(value),
                    'description': f"Common value for {field}"
                })

    return suggestions[:20]  # Limit suggestions

#################
# POST requests #
#################

# Power Search endpoints
@ps_router.post("/api/power-search/analyze")
async def analyze_log_structure(request: dict):
    """
    Analyze log structure to discover fields and patterns
    """
    import main
    main.safe_restore_sessions()

    session_id = request.get('session_id')
    log_files = request.get('log_files', {})

    if not session_id:
        raise HTTPException(400, "Session ID required")

    if session_id not in main.extracted_files:
        raise HTTPException(404, "Session not found")

    # Add full paths to log files
    session_dir = main.extracted_files[session_id]
    for file_path, file_info in log_files.items():
        file_info['full_path'] = str(session_dir / file_path)

    # Analyze log structure
    analysis = power_search.analyze_log_structure(session_id, log_files)

    return analysis

@ps_router.post("/api/power-search/search")
async def power_search_logs(request: dict):
    """
    Execute power search with streaming results
    """
    import main

    session_id = request.get('session_id')
    query_string = request.get('query', '')
    limit = request.get('limit', 100)
    context_lines = request.get('context_lines', 0)
    stream = request.get('stream', True)

    if not session_id:
        raise HTTPException(400, "Session ID required")

    if not query_string:
        raise HTTPException(400, "Query required")

    if session_id not in main.analysis_sessions:
        raise HTTPException(404, "Session not found")

    # Get log files with full paths
    log_files = main.analysis_sessions[session_id].get('log_files', {})
    session_dir = main.extracted_files.get(session_id)

    if not session_dir:
        raise HTTPException(404, "Extracted files not found")

    # Add full paths
    for file_path, file_info in log_files.items():
        file_info['full_path'] = str(session_dir / file_path)

    # Parse query
    try:
        query = power_search.parse_query(query_string)
    except Exception as e:
        raise HTTPException(400, f"Invalid query: {str(e)}")

    async def generate_results():
        """Generate search results as JSON stream"""
        try:
            # Execute search
            for result in power_search.search(
                session_id=session_id,
                query=query,
                files=log_files,
                limit=limit,
                context_lines=context_lines
            ):
                # Yield each result as JSON line
                yield json.dumps(result) + '\n'

                # Small delay to prevent overwhelming the client
                if stream:
                    await asyncio.sleep(0.001)

        except Exception as e:
            error_result = {
                'error': str(e),
                'type': 'search_error'
            }
            yield json.dumps(error_result) + '\n'

    if stream:
        return StreamingResponse(
            generate_results(),
            media_type="application/x-ndjson"
        )
    else:
        # Collect all results and return as array
        results = []
        async for line in generate_results():
            if line.strip():
                results.append(json.loads(line))
        return results

@ps_router.post("/api/power-search/validate-query")
async def validate_query(request: dict):
    """
    Validate and explain a query without executing it
    """
    query_string = request.get('query', '')

    try:
        query = power_search.parse_query(query_string)

        # Generate explanation
        explanation = {
            'valid': True,
            'filters': [],
            'logical_operator': query.logical_op.value
        }

        for filter_item in query.filters:
            explanation['filters'].append({
                'field': filter_item.field,
                'operator': filter_item.operator.value,
                'value': filter_item.value,
                'description': f"Find logs where {filter_item.field or 'content'} {filter_item.operator.value} {filter_item.value}"
            })

        return explanation

    except Exception as e:
        return {
            'valid': False,
            'error': str(e)
        }

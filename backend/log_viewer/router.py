import asyncio
import json
import os
from pathlib import Path
from typing import Optional, Dict, Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse

log_router = APIRouter()

################
# GET requests #
################

@log_router.get("/api/logs/{session_id}/{file_path:path}")
async def get_log_content(session_id: str, file_path: str):
    """Get actual log file content - optimized but complete"""
    import main
    main.safe_restore_sessions()

    if session_id not in main.analysis_sessions:
        raise HTTPException(404, "Session not found")

    if session_id not in main.extracted_files:
        raise HTTPException(404, "Extracted files not found")

    # Get the actual file path
    session_dir = main.extracted_files[session_id]
    actual_path = session_dir / file_path

    if not actual_path.exists():
        raise HTTPException(404, f"Log file not found: {file_path}")

    try:
        file_size = actual_path.stat().st_size

        # Read ALL lines - no limiting for log analysis
        lines = []
        with open(actual_path, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                lines.append(line.rstrip())

        return {
            "file": file_path,
            "content": lines,
            "total_lines": len(lines),
            "file_size": file_size,
            "truncated": False  # Never truncate for log analysis
        }

    except Exception as e:
        raise HTTPException(500, f"Error reading file: {str(e)}")


@log_router.get("/api/logs/{session_id}/{file_path:path}/more")
async def get_more_log_content(session_id: str, file_path: str, offset: int = 0, lines: int = 1000):
    """Get more log content starting from offset"""
    import main
    main.safe_restore_sessions()

    if session_id not in main.extracted_files:
        raise HTTPException(404, "Session not found")

    session_dir = main.extracted_files[session_id]
    actual_path = session_dir / file_path

    if not actual_path.exists():
        raise HTTPException(404, f"Log file not found: {file_path}")

    try:
        content_lines = []
        current_line = 0

        with open(actual_path, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                if current_line >= offset:
                    if len(content_lines) >= lines:
                        break
                    content_lines.append(line.rstrip())
                current_line += 1

        return {
            "content": content_lines,
            "offset": offset,
            "lines_returned": len(content_lines),
            "has_more": len(content_lines) == lines
        }

    except Exception as e:
        raise HTTPException(500, f"Error reading file: {str(e)}")


@log_router.get("/api/logs/{session_id}/{file_path:path}/raw")
async def get_raw_log(session_id: str, file_path: str):
    """Stream raw file - handles nested paths correctly"""
    import main
    main.safe_restore_sessions()

    if session_id not in main.extracted_files:
        raise HTTPException(404, "Session not found")

    session_dir = main.extracted_files[session_id]

    # Try the exact path first
    actual_path = session_dir / file_path

    # If not found, try without the session prefix (common issue)
    if not actual_path.exists():
        # The file_path might include redundant directory structure
        # Try to find the file by searching for it
        parts = file_path.split('/')

        # Try different combinations
        for i in range(len(parts)):
            test_path = session_dir / '/'.join(parts[i:])
            if test_path.exists() and test_path.is_file():
                actual_path = test_path
                break

    # Still not found? Try searching for the file
    if not actual_path.exists():
        file_name = os.path.basename(file_path)
        # Search for the file in the session directory
        for root, dirs, files in os.walk(session_dir):
            if file_name in files:
                actual_path = Path(root) / file_name
                break

    if not actual_path.exists() or not actual_path.is_file():
        print(f"File not found: {actual_path}")
        print(f"Session dir: {session_dir}")
        print(f"Requested path: {file_path}")
        raise HTTPException(404, f"File not found: {file_path}")

    return FileResponse(actual_path, media_type="text/plain")


# Add this new endpoint to main.py - keeps existing endpoints intact
@log_router.get("/api/logs/{session_id}/{file_path:path}/metadata")
async def get_log_metadata(session_id: str, file_path: str):
    """Get file metadata without loading all content - for performance"""
    import main
    main.safe_restore_sessions()

    if session_id not in main.extracted_files:
        raise HTTPException(404, "Session not found")

    session_dir = main.extracted_files[session_id]
    actual_path = session_dir / file_path

    if not actual_path.exists():
        raise HTTPException(404, f"Log file not found: {file_path}")

    try:
        # Quick line count without loading everything
        line_count = 0
        json_count = 0
        file_size = actual_path.stat().st_size

        # Sample first 100 lines for JSON detection
        with open(actual_path, 'r', encoding='utf-8', errors='ignore') as f:
            for i, line in enumerate(f):
                line_count += 1
                if i < 100 and line.strip().startswith('{'):
                    try:
                        json.loads(line)
                        json_count += 1
                    except:
                        pass

        is_json = json_count > 30  # >30% of sample is JSON

        return {
            "file": file_path,
            "total_lines": line_count,
            "file_size": file_size,
            "is_json_log": is_json,
            "should_virtualize": line_count > 10000  # Virtualize large files
        }

    except Exception as e:
        raise HTTPException(500, f"Error reading metadata: {str(e)}")


# Enhanced metadata endpoint with better JSON detection
@log_router.get("/api/logs/{session_id}/{file_path:path}/metadata")
async def get_log_metadata(session_id: str, file_path: str):
    """Get file metadata with enhanced JSON detection"""
    import main
    main.safe_restore_sessions()

    if session_id not in main.extracted_files:
        raise HTTPException(404, "Session not found")

    session_dir = main.extracted_files[session_id]
    actual_path = session_dir / file_path

    if not actual_path.exists():
        raise HTTPException(404, f"Log file not found: {file_path}")

    try:
        line_count = 0
        json_count = 0
        file_size = actual_path.stat().st_size
        json_fields = set()

        # Enhanced sampling - check more lines for better detection
        sample_size = min(500, file_size // 1000)  # Sample more lines for large files

        with open(actual_path, 'r', encoding='utf-8', errors='ignore') as f:
            for i, line in enumerate(f):
                line_count += 1
                if i < sample_size:
                    line_stripped = line.strip()
                    if line_stripped.startswith('{') and line_stripped.endswith('}'):
                        try:
                            parsed = json.loads(line)
                            json_count += 1
                            json_fields.update(parsed.keys())
                        except:
                            pass

        # Better JSON detection logic
        is_json = (
                json_count > sample_size * 0.1 or  # >10% JSON
                file_path.endswith('.json') or
                'json' in file_path.lower() or
                (json_count > 5 and len(json_fields) > 3)  # Has structured JSON
        )

        return {
            "file": file_path,
            "total_lines": line_count,
            "file_size": file_size,
            "is_json_log": is_json,
            "detected_fields": list(json_fields)[:50],  # Return top 50 fields
            "json_ratio": json_count / max(sample_size, 1),
            "should_virtualize": line_count > 5000,  # Lower threshold for virtualization
            "recommended_chunk_size": min(10000, max(1000, line_count // 10))
        }

    except Exception as e:
        raise HTTPException(500, f"Error reading metadata: {str(e)}")


# Main content endpoint - optimized for full search
@log_router.get("/api/logs/{session_id}/{file_path:path}")
async def get_log_content(session_id: str, file_path: str):
    """Get complete log file content for robust searching"""
    import main
    main.safe_restore_sessions()

    if session_id not in main.analysis_sessions:
        raise HTTPException(404, "Session not found")

    if session_id not in main.extracted_files:
        raise HTTPException(404, "Extracted files not found")

    session_dir = main.extracted_files[session_id]
    actual_path = session_dir / file_path

    if not actual_path.exists():
        raise HTTPException(404, f"Log file not found: {file_path}")

    try:
        file_size = actual_path.stat().st_size

        # Read ALL lines for complete search capability
        lines = []
        with open(actual_path, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                lines.append(line.rstrip())

        return {
            "file": file_path,
            "content": lines,  # Return ALL lines
            "total_lines": len(lines),
            "file_size": file_size,
            "truncated": False,
            "encoding": "utf-8"
        }

    except MemoryError:
        # If file is too large for memory, offer streaming alternative
        raise HTTPException(413,
                            "File too large for memory. Use streaming endpoint /api/logs/{session_id}/{file_path}/stream")
    except Exception as e:
        raise HTTPException(500, f"Error reading file: {str(e)}")


# Streaming endpoint for very large files
@log_router.get("/api/logs/{session_id}/{file_path:path}/stream")
async def stream_log_content(
        session_id: str,
        file_path: str,
        start_line: int = Query(0, description="Starting line number"),
        end_line: Optional[int] = Query(None, description="Ending line number"),
        chunk_size: int = Query(10000, description="Lines per chunk")
):
    """Stream log content for very large files"""

    import main
    main.safe_restore_sessions()

    if session_id not in main.extracted_files:
        raise HTTPException(404, "Session not found")

    session_dir = main.extracted_files[session_id]
    actual_path = session_dir / file_path

    if not actual_path.exists():
        raise HTTPException(404, f"Log file not found: {file_path}")

    async def generate():
        current_line = 0
        chunk = []

        with open(actual_path, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                if current_line >= start_line:
                    if end_line and current_line >= end_line:
                        break

                    chunk.append(line.rstrip())

                    if len(chunk) >= chunk_size:
                        yield json.dumps({
                            "lines": chunk,
                            "start": current_line - len(chunk) + 1,
                            "end": current_line
                        }) + "\n"
                        chunk = []
                        await asyncio.sleep(0)  # Allow other tasks

                current_line += 1

            # Send remaining chunk
            if chunk:
                yield json.dumps({
                    "lines": chunk,
                    "start": current_line - len(chunk),
                    "end": current_line - 1,
                    "complete": True
                }) + "\n"

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={"X-Content-Type-Options": "nosniff"}
    )


# Download endpoint remains the same but with better error handling
@log_router.get("/api/logs/{session_id}/{file_path:path}/download")
async def download_log(session_id: str, file_path: str):
    """Download full log file"""
    import main
    main.safe_restore_sessions()

    if session_id not in main.extracted_files:
        raise HTTPException(404, "Session not found")

    session_dir = main.extracted_files[session_id]
    actual_path = session_dir / file_path

    if not actual_path.exists():
        raise HTTPException(404, "File not found")

    def iterfile():
        with open(actual_path, 'rb') as f:
            while chunk := f.read(1024 * 1024):  # 1MB chunks
                yield chunk

    filename = Path(file_path).name

    return StreamingResponse(
        iterfile(),
        media_type="text/plain",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Type": "text/plain; charset=utf-8"
        }
    )


# Field extraction endpoint for better field discovery
@log_router.get("/api/logs/{session_id}/{file_path:path}/fields")
async def extract_log_fields(
        session_id: str,
        file_path: str,
        sample_size: int = Query(1000, description="Number of lines to sample")
):
    """Extract available fields from JSON log files"""
    import main
    main.safe_restore_sessions()

    if session_id not in main.extracted_files:
        raise HTTPException(404, "Session not found")

    session_dir = main.extracted_files[session_id]
    actual_path = session_dir / file_path

    if not actual_path.exists():
        raise HTTPException(404, f"Log file not found: {file_path}")

    try:
        fields = {}
        lines_sampled = 0
        json_lines = 0

        with open(actual_path, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                if lines_sampled >= sample_size:
                    break

                lines_sampled += 1
                line_stripped = line.strip()

                if line_stripped.startswith('{'):
                    try:
                        parsed = json.loads(line_stripped)
                        json_lines += 1

                        for key, value in parsed.items():
                            if key not in fields:
                                fields[key] = {
                                    'type': type(value).__name__,
                                    'count': 0,
                                    'sample_values': set(),
                                    'nullable': False
                                }

                            fields[key]['count'] += 1

                            if value is None:
                                fields[key]['nullable'] = True
                            elif fields[key]['sample_values'] is not None:
                                if len(fields[key]['sample_values']) < 50:
                                    val_str = str(value)
                                    if len(val_str) < 200:  # Don't store huge values
                                        fields[key]['sample_values'].add(val_str)
                                else:
                                    fields[key]['sample_values'] = None  # Too many unique values
                    except:
                        pass

        # Convert sets to lists for JSON serialization
        for field in fields.values():
            if field['sample_values'] is not None:
                field['sample_values'] = list(field['sample_values'])[:20]

        return {
            "fields": fields,
            "lines_sampled": lines_sampled,
            "json_lines": json_lines,
            "is_json_file": json_lines > lines_sampled * 0.1
        }

    except Exception as e:
        raise HTTPException(500, f"Error extracting fields: {str(e)}")


#################
# POST requests #
#################

# Server-side search endpoint for extremely large files
@log_router.post("/api/logs/{session_id}/{file_path:path}/search")
async def search_in_log(
        session_id: str,
        file_path: str,
        query: Dict[str, Any],
        max_results: int = Query(1000, description="Maximum results to return"),
        context_lines: int = Query(0, description="Context lines around matches")
):
    """Server-side search for extremely large log files"""
    import main
    main.safe_restore_sessions()

    if session_id not in main.extracted_files:
        raise HTTPException(404, "Session not found")

    session_dir = main.extracted_files[session_id]
    actual_path = session_dir / file_path

    if not actual_path.exists():
        raise HTTPException(404, f"Log file not found: {file_path}")

    def evaluate_condition(condition: Dict, line: str, parsed_json: Optional[Dict] = None) -> bool:
        """Evaluate a search condition"""

        cond_type = condition.get('type')

        if cond_type == 'TEXT':
            return condition['value'].lower() in line.lower()

        elif cond_type == 'OR':
            return any(evaluate_condition(c, line, parsed_json) for c in condition['conditions'])

        elif cond_type == 'AND':
            return all(evaluate_condition(c, line, parsed_json) for c in condition['conditions'])

        elif cond_type == 'NOT':
            return not evaluate_condition(condition['condition'], line, parsed_json)

        elif cond_type in ['FIELD_EQ', 'FIELD_NEQ', 'FIELD_GT', 'FIELD_GTE', 'FIELD_LT', 'FIELD_LTE']:
            if parsed_json is None:
                # Try to parse JSON
                if line.strip().startswith('{'):
                    try:
                        parsed_json = json.loads(line)
                    except:
                        return False
                else:
                    return False

            field = condition['field']
            value = condition['value']
            field_value = parsed_json.get(field)

            if field_value is None:
                return cond_type == 'FIELD_NEQ'

            if cond_type == 'FIELD_EQ':
                return str(field_value).lower() == str(value).lower()
            elif cond_type == 'FIELD_NEQ':
                return str(field_value).lower() != str(value).lower()
            elif cond_type == 'FIELD_GT':
                return float(field_value) > float(value)
            elif cond_type == 'FIELD_GTE':
                return float(field_value) >= float(value)
            elif cond_type == 'FIELD_LT':
                return float(field_value) < float(value)
            elif cond_type == 'FIELD_LTE':
                return float(field_value) <= float(value)

        return True

    try:
        results = []
        total_lines = 0
        matches_found = 0

        with open(actual_path, 'r', encoding='utf-8', errors='ignore') as f:
            for line_num, line in enumerate(f):
                total_lines += 1
                line_stripped = line.rstrip()

                # Parse JSON if needed
                parsed_json = None
                if line_stripped.startswith('{'):
                    try:
                        parsed_json = json.loads(line_stripped)
                    except:
                        pass

                # Evaluate search condition
                if evaluate_condition(query, line_stripped, parsed_json):
                    matches_found += 1

                    # Add context if requested
                    result_entry = {
                        "line_number": line_num + 1,
                        "content": line_stripped
                    }

                    if context_lines > 0:
                        # Add context (would need to buffer lines for this)
                        result_entry["context"] = {
                            "before": [],
                            "after": []
                        }

                    results.append(result_entry)

                    if len(results) >= max_results:
                        break

        return {
            "total_lines": total_lines,
            "total_matches": matches_found,
            "results": results,
            "truncated": matches_found > len(results)
        }

    except Exception as e:
        raise HTTPException(500, f"Search error: {str(e)}")

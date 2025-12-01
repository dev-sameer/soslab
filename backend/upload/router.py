from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, UploadFile, HTTPException

router = APIRouter()

#################
# POST requests #
#################

@router.post("/api/upload")
async def upload_sos(
        background_tasks: BackgroundTasks,
        file: UploadFile
):
    """Handle SOS file upload"""

    if not file.filename.endswith(('.tar', '.tar.gz', '.tgz', '.zip')):
        raise HTTPException(400, "Invalid file format")

    session_id = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{file.filename}"

    # Save uploaded file
    upload_path = Path("data/uploads")
    upload_path.mkdir(parents=True, exist_ok=True)

    file_path = upload_path / f"{session_id}_{file.filename}"
    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)

    from main import analyze_sos_task

    # Start analysis in background
    background_tasks.add_task(
        analyze_sos_task,
        session_id,
        file_path
    )

    return {
        "session_id": session_id,
        "status": "processing",
        "message": "Analysis started"
    }

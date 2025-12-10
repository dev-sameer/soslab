#!/usr/bin/env python3
"""
Test GitLab Duo Chat API endpoints
"""
import asyncio
import os
from gitlab_duo_chat import GitLabDuoChatIntegration

async def test_models():
    """Test getting available models and updating selection"""
    print("🧪 Testing GitLab Duo Chat API\n")
    
    duo = GitLabDuoChatIntegration()
    
    if not duo.enabled:
        print("❌ GitLab Duo is not enabled - GITLAB_TOKEN not set")
        return
    
    print(f"✅ GitLab Duo enabled")
    print(f"   URL: {duo.gitlab_url}")
    print()
    
    # Test 1: Get available models
    print("📋 Test 1: Fetching available models...")
    models = await duo.get_available_models()
    print(f"Default model: {models['defaultModel']}")
    print(f"Available models: {len(models['availableModels'])} models")
    for m in models['availableModels']:
        print(f"  - {m['displayName']} ({m['name']})")
    print()
    
    # Test 2: Get user ID
    print("👤 Test 2: Auto-detecting user ID...")
    await duo._ensure_user_detected()
    print(f"User ID: {duo.user_id}")
    print()
    
    # Test 3: Try to update model selection
    print("🔄 Test 3: Attempting to update model selection...")
    print("   (This requires a valid group ID with Duo Chat enabled)")
    
    # Try with a test group ID - this will likely fail but shows the flow
    test_group_id = "gid://gitlab/Group/9970"  # Replace with your actual group ID
    test_model = "gpt-4o"
    
    result = await duo.update_model_selection(test_group_id, test_model)
    print(f"Result: {result}")
    print()
    
    # Cleanup
    await duo.close()
    print("✅ Tests complete")

if __name__ == "__main__":
    asyncio.run(test_models())


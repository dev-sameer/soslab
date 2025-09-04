#!/usr/bin/env python3
"""
Standalone MCP Server for GitLab SOS Analyzer
Run this separately from main.py
"""

from mcp_unix_server import create_mcp_server

if __name__ == "__main__":
    print("🚀 Starting MCP Server for GitLab Duo...")
    print("📁 Base directory: data/extracted")
    print("🔗 Server URL: http://localhost:8080/mcp")
    print("-" * 50)
    
    mcp_server = create_mcp_server(base_dir="data/extracted")
    mcp_server.start(host="0.0.0.0", port=8080)
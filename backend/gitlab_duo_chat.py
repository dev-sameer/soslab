# gitlab_duo_chat.py
"""
GitLab Duo Chat Integration - GraphQL Version
No more chunking needed - GraphQL handles long messages natively
"""

import os
import json
import aiohttp
import asyncio
from typing import Dict, List, Optional
from datetime import datetime
from pathlib import Path
import uuid
import re

class GitLabDuoChatIntegration:
    def __init__(self):
        # Environment variables
        self.pat = os.environ.get('GITLAB_PAT')
        self.gitlab_url = os.environ.get('GITLAB_INSTANCE_URL', 'https://gitlab.com')
        self.user_id = os.environ.get('GITLAB_USER_ID')  # Can be auto-detected
        
        if not self.pat:
            print("⚠️  GITLAB_PAT not found. GitLab Duo features will be disabled.")
            print("   Set it using: export GITLAB_PAT='your-token-here'")
            self.enabled = False
        else:
            self.enabled = True
            print("✅ GitLab Duo Chat GraphQL integration enabled")
            
        # Validate URL format
        if self.gitlab_url and not self.gitlab_url.startswith(('http://', 'https://')):
            self.gitlab_url = f'https://{self.gitlab_url}'
        
        # Local storage for fallback
        self.conversations_dir = Path("data/conversations")
        self.conversations_dir.mkdir(parents=True, exist_ok=True)
        
        # GraphQL endpoint
        self.graphql_url = f"{self.gitlab_url}/api/graphql"
        
        # Headers
        self.headers = {
            'Authorization': f'Bearer {self.pat}',
            'Content-Type': 'application/json'
        }
        
        # Session management
        self.session_contexts = {}
        self.thread_mappings = {}  # Map session_id to GitLab thread_id
        
        # Persistent HTTP session
        self._session = None
        self._user_id_detected = False
    
    async def _ensure_user_detected(self):
        """Ensure user ID is detected before first use"""
        if not self._user_id_detected and self.enabled and not self.user_id:
            await self._auto_detect_user()
            self._user_id_detected = True
    async def _auto_detect_user(self):
        """Auto-detect GitLab user ID"""
        try:
            session = await self.get_session()
            async with session.get(
                f"{self.gitlab_url}/api/v4/user",
                headers={'Authorization': f'Bearer {self.pat}'}
            ) as response:
                if response.status == 200:
                    user_data = await response.json()
                    self.user_id = f"gid://gitlab/User/{user_data['id']}"
                    print(f"✅ Auto-detected user ID: {self.user_id}")
        except Exception as e:
            print(f"Could not auto-detect user ID: {e}")
    
    async def get_session(self):
        """Get or create persistent HTTP session"""
        if not self._session:
            timeout = aiohttp.ClientTimeout(total=30, connect=5)
            connector = aiohttp.TCPConnector(
                limit=100,
                limit_per_host=30,
                ttl_dns_cache=300
            )
            self._session = aiohttp.ClientSession(
                connector=connector,
                timeout=timeout,
                headers=self.headers
            )
        return self._session
    
    async def close(self):
        """Cleanup session"""
        if self._session:
            await self._session.close()
            self._session = None
    
    def add_session_context(self, session_id: str, analysis_data: Dict):
        """Add analysis context for a session"""
        context = {
            'session_id': session_id,
            'services': list(set(f.get('service', 'unknown') 
                               for f in analysis_data.get('log_files', {}).values()))[:10],
            'timestamp': datetime.now().isoformat()
        }
        self.session_contexts[session_id] = context
    
    async def send_chat_message(self, 
                               message: str, 
                               session_id: str,
                               thread_id: Optional[str] = None) -> Dict:
        """Send message via GraphQL - no chunking needed!"""
        
        if not self.enabled:
            return {
                'requestId': str(uuid.uuid4()),
                'threadId': thread_id or f"local_{session_id}",
                'response': "GitLab Duo Chat is not available. Please set the GITLAB_PAT environment variable.",
                'errors': ['GITLAB_PAT not configured']
            }
        
        # Ensure user ID is detected
        await self._ensure_user_detected()
        
        # Get persistent session
        session = await self.get_session()
        
        # Use stored thread mapping if available
        if not thread_id and session_id in self.thread_mappings:
            thread_id = self.thread_mappings[session_id]
        
        # GraphQL mutation for aiAction
        mutation = """
        mutation($input: AiActionInput!) {
            aiAction(input: $input) {
                requestId
                threadId
                errors
            }
        }
        """
        
        # Build variables - no character limit!
        variables = {
            "input": {
                "chat": {
                    "resourceId": self.user_id or "gid://gitlab/User/1",
                    "content": message  # Full message, no chunking
                },
                "conversationType": "DUO_CHAT"
            }
        }
        
        # Add thread ID if continuing conversation
        if thread_id:
            variables["input"]["threadId"] = thread_id
        
        try:
            # Send mutation
            async with session.post(
                self.graphql_url,
                json={
                    "query": mutation,
                    "variables": variables
                }
            ) as response:
                
                if response.status == 404:
                    raise Exception("GraphQL endpoint not found")
                
                if response.status == 403:
                    raise Exception("Access denied. Check your PAT token permissions")
                
                data = await response.json()
                
                if data.get('errors'):
                    error_msg = data['errors'][0].get('message', 'Unknown error')
                    raise Exception(f"GraphQL error: {error_msg}")
                
                result = data['data']['aiAction']
                
                # Store thread mapping
                if result.get('threadId'):
                    self.thread_mappings[session_id] = result['threadId']
                
                # Poll for response
                assistant_response = await self._poll_for_response(
                    result['requestId'], 
                    result.get('threadId'),
                    session
                )
                
                return {
                    'requestId': result['requestId'],
                    'threadId': result.get('threadId') or thread_id,
                    'response': assistant_response,
                    'errors': []
                }
                
        except Exception as e:
            print(f"❌ Error: {str(e)}")
            return {
                'requestId': str(uuid.uuid4()),
                'threadId': thread_id or f"local_{session_id}",
                'response': f"Error: {str(e)}",
                'errors': [str(e)]
            }
    
    async def _poll_for_response(self, 
                                request_id: str, 
                                thread_id: Optional[str],
                                session: aiohttp.ClientSession,
                                max_attempts: int = 30) -> str:
        """Poll for assistant response"""
        
        query = """
        query($threadId: AiConversationThreadID) {
            aiMessages(threadId: $threadId) {
                nodes {
                    requestId
                    content
                    role
                    errors
                }
            }
        }
        """
        
        for attempt in range(max_attempts):
            try:
                async with session.post(
                    self.graphql_url,
                    json={
                        "query": query,
                        "variables": {"threadId": thread_id} if thread_id else {}
                    }
                ) as response:
                    
                    data = await response.json()
                    
                    if data.get('data', {}).get('aiMessages', {}).get('nodes'):
                        messages = data['data']['aiMessages']['nodes']
                        
                        # Find the assistant response for this request
                        assistant_msg = next(
                            (msg for msg in messages 
                             if msg['role'] == 'ASSISTANT' 
                             and msg['requestId'] == request_id
                             and msg.get('content')),
                            None
                        )
                        
                        if assistant_msg:
                            return assistant_msg['content']
                    
                    # Wait before next poll
                    await asyncio.sleep(1)
                    
            except Exception as e:
                print(f"Polling error: {e}")
                break
        
        return "Response timeout - the request may still be processing."
    
    async def load_thread_messages(self, thread_id: str) -> List[Dict]:
        """Load all messages from a thread"""
        
        if not self.enabled:
            return []
        
        query = """
        query($threadId: AiConversationThreadID!) {
            aiMessages(threadId: $threadId) {
                nodes {
                    content
                    role
                    timestamp
                }
            }
        }
        """
        
        try:
            session = await self.get_session()
            async with session.post(
                self.graphql_url,
                json={
                    "query": query,
                    "variables": {"threadId": thread_id}
                }
            ) as response:
                
                data = await response.json()
                
                if data.get('data', {}).get('aiMessages', {}).get('nodes'):
                    return [
                        {
                            "role": msg['role'].lower(),
                            "content": msg['content'],
                            "timestamp": msg['timestamp']
                        }
                        for msg in data['data']['aiMessages']['nodes']
                        if msg.get('content')
                    ]
                    
        except Exception as e:
            print(f"Error loading thread: {e}")
        
        return []
    
    async def list_threads(self) -> List[Dict]:
        """List all conversation threads"""
        
        if not self.enabled:
            return []
        
        query = """
        query {
            aiConversationThreads(conversationType: DUO_CHAT) {
                nodes {
                    id
                    createdAt
                }
            }
        }
        """
        
        try:
            session = await self.get_session()
            async with session.post(
                self.graphql_url,
                json={"query": query}
            ) as response:
                
                data = await response.json()
                
                if data.get('data', {}).get('aiConversationThreads', {}).get('nodes'):
                    return data['data']['aiConversationThreads']['nodes']
                    
        except Exception as e:
            print(f"Error listing threads: {e}")
        
        return []
    
    def save_conversation(self, session_id: str, messages: List[Dict]):
        """Save conversation locally as backup"""
        filename = self.conversations_dir / f"{session_id}_chat.json"
        with open(filename, 'w') as f:
            json.dump({
                'session_id': session_id,
                'thread_id': self.thread_mappings.get(session_id),
                'messages': messages,
                'timestamp': datetime.now().isoformat()
            }, f, indent=2)
    
    def load_conversations(self, session_id: str) -> List[Dict]:
        """Load local conversation backup"""
        filename = self.conversations_dir / f"{session_id}_chat.json"
        if filename.exists():
            with open(filename, 'r') as f:
                return [json.load(f)]
        return []
    
    async def analyze_with_chat(self, query: str, session_id: str) -> Dict:
        """Analyze logs using natural language query"""
        
        if not self.enabled:
            return {
                'thread_id': f"local_{session_id}",
                'response': "GitLab Duo Chat is not available. Please set the GITLAB_PAT environment variable.",
                'context_used': False,
                'session_id': session_id,
                'error': 'GITLAB_PAT not configured'
            }
        
        response = await self.send_chat_message(query, session_id)
        
        return {
            'thread_id': response.get('threadId'),
            'response': response.get('response'),
            'context_used': session_id in self.session_contexts,
            'session_id': session_id
        }
    
    def create_log_search_query(self, natural_query: str, context: Dict) -> str:
        """Convert natural language to power search query"""
        query_parts = []
        
        patterns = {
            'error': 'severity:error OR severity:critical',
            'timeout': '(timeout OR "timed out" OR "deadline exceeded")',
            'database|db': '(service:postgresql OR service:mysql OR "database")',
            'sidekiq': 'service:sidekiq',
            'gitaly': 'service:gitaly',
            'nginx': 'service:nginx',
            'rails': 'service:rails',
            'redis': 'service:redis',
            'last hour': 'time:[now-1h TO now]',
            'today': 'time:[today TO now]'
        }
        
        natural_lower = natural_query.lower()
        for pattern, query in patterns.items():
            if re.search(pattern, natural_lower):
                query_parts.append(query)
        
        return ' AND '.join(query_parts) if query_parts else natural_query
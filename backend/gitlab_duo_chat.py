# gitlab_duo_chat.py
"""
GitLab Duo Chat Integration - GraphQL with Real Streaming
==========================================================
Uses:
- `chat` endpoint (not agenticChat)
- WebSocket subscription for real streaming
- Falls back to polling if WebSocket unavailable
"""

import os
import json
import aiohttp
import asyncio
import websockets
from typing import Dict, List, Optional, AsyncGenerator, Callable
from datetime import datetime
from pathlib import Path
import uuid
import ssl


class GitLabDuoChat:
    """GitLab Duo Chat with real-time streaming support"""
    
    def __init__(self):
        self.gitlab_token = os.environ.get('GITLAB_TOKEN') or os.environ.get('GITLAB_PAT')
        self.gitlab_url = os.environ.get('GITLAB_INSTANCE_URL', 'https://gitlab.com')
        
        # Ensure URL format
        if self.gitlab_url and not self.gitlab_url.startswith(('http://', 'https://')):
            self.gitlab_url = f'https://{self.gitlab_url}'
        
        self.enabled = bool(self.gitlab_token)
        self.user_id = os.environ.get('GITLAB_USER_ID')
        
        if self.enabled:
            print(f"✅ GitLab Duo Chat enabled")
            print(f"   URL: {self.gitlab_url}")
        else:
            print("⚠️  GITLAB_TOKEN not found - Duo Chat disabled")
        
        # Endpoints
        self.graphql_url = f"{self.gitlab_url}/api/graphql"
        self.cable_url = self._get_cable_url()
        
        # Headers
        self.headers = {
            'Authorization': f'Bearer {self.gitlab_token}',
            'Content-Type': 'application/json'
        }
        
        # Session management
        self.thread_mappings: Dict[str, str] = {}  # session_id -> thread_id
        self._http_session: Optional[aiohttp.ClientSession] = None
        self._user_detected = False
        
        # Storage
        self.storage_dir = Path("data/duo_chat")
        self.storage_dir.mkdir(parents=True, exist_ok=True)
    
    def _get_cable_url(self) -> str:
        """Get ActionCable WebSocket URL"""
        # Convert https://gitlab.com to wss://gitlab.com/-/cable
        ws_url = self.gitlab_url.replace('https://', 'wss://').replace('http://', 'ws://')
        return f"{ws_url}/-/cable"
    
    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create HTTP session"""
        if not self._http_session or self._http_session.closed:
            timeout = aiohttp.ClientTimeout(total=120)
            self._http_session = aiohttp.ClientSession(
                timeout=timeout,
                headers=self.headers
            )
        return self._http_session
    
    async def _ensure_user_id(self):
        """Auto-detect user ID if not set"""
        if self._user_detected or self.user_id:
            return
        
        try:
            session = await self._get_session()
            async with session.get(
                f"{self.gitlab_url}/api/v4/user",
                headers={'Authorization': f'Bearer {self.gitlab_token}'}
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    self.user_id = f"gid://gitlab/User/{data['id']}"
                    print(f"✅ Detected user: {self.user_id}")
        except Exception as e:
            print(f"⚠️  Could not detect user: {e}")
        
        self._user_detected = True
    
    async def close(self):
        """Cleanup resources"""
        if self._http_session and not self._http_session.closed:
            await self._http_session.close()
    
    # =========================================================================
    # MAIN CHAT METHOD
    # =========================================================================
    
    async def send_message(
        self,
        message: str,
        session_id: str,
        thread_id: Optional[str] = None,
        on_chunk: Optional[Callable[[str], None]] = None
    ) -> Dict:
        """
        Send a chat message with optional streaming.
        
        Args:
            message: The user's message
            session_id: Local session identifier
            thread_id: GitLab thread ID (for continuing conversations)
            on_chunk: Callback for streaming chunks (if None, returns full response)
        
        Returns:
            Dict with threadId, response, requestId, etc.
        """
        
        if not self.enabled:
            return {
                'success': False,
                'error': 'GITLAB_TOKEN not configured',
                'response': 'GitLab Duo Chat not available. Set GITLAB_TOKEN.'
            }
        
        await self._ensure_user_id()
        
        # Use stored thread if available
        if not thread_id and session_id in self.thread_mappings:
            thread_id = self.thread_mappings[session_id]
        
        # Generate subscription ID for streaming
        client_subscription_id = str(uuid.uuid4())
        
        # Send the mutation
        result = await self._send_chat_mutation(
            message=message,
            thread_id=thread_id,
            client_subscription_id=client_subscription_id
        )
        
        if not result['success']:
            return result
        
        request_id = result['requestId']
        response_thread_id = result.get('threadId') or thread_id
        
        # Store thread mapping
        if response_thread_id:
            self.thread_mappings[session_id] = response_thread_id
        
        # Get response - try streaming first, fall back to polling
        if on_chunk:
            # Try WebSocket streaming
            response_text = await self._stream_response_websocket(
                user_id=self.user_id,
                client_subscription_id=client_subscription_id,
                on_chunk=on_chunk
            )
            
            # If WebSocket failed, fall back to polling
            if response_text is None:
                print("⚠️  WebSocket streaming failed, falling back to polling...")
                response_text = await self._poll_for_response(
                    request_id=request_id,
                    thread_id=response_thread_id,
                    on_chunk=on_chunk
                )
        else:
            # No streaming callback - just poll for full response
            response_text = await self._poll_for_response(
                request_id=request_id,
                thread_id=response_thread_id
            )
        
        return {
            'success': True,
            'requestId': request_id,
            'threadId': response_thread_id,
            'response': response_text,
            'error': None
        }
    
    # =========================================================================
    # GRAPHQL MUTATION
    # =========================================================================
    
    async def _send_chat_mutation(
        self,
        message: str,
        thread_id: Optional[str],
        client_subscription_id: str
    ) -> Dict:
        """Send the aiAction mutation"""
        
        mutation = """
        mutation($input: AiActionInput!) {
            aiAction(input: $input) {
                requestId
                threadId
                errors
            }
        }
        """
        
        variables = {
            "input": {
                "chat": {
                    "resourceId": self.user_id or "gid://gitlab/User/1",
                    "content": message
                },
                "conversationType": "DUO_CHAT",
                "clientSubscriptionId": client_subscription_id
            }
        }
        
        # Add thread ID for conversation continuity
        if thread_id and thread_id.startswith('gid://'):
            variables["input"]["threadId"] = thread_id
        
        print(f"📤 Sending: {message[:50]}...")
        
        try:
            session = await self._get_session()
            async with session.post(
                self.graphql_url,
                json={"query": mutation, "variables": variables}
            ) as response:
                data = await response.json()
                
                if data.get('errors'):
                    error = data['errors'][0].get('message', 'Unknown error')
                    print(f"❌ GraphQL error: {error}")
                    return {'success': False, 'error': error}
                
                result = data['data']['aiAction']
                
                if result.get('errors') and len(result['errors']) > 0:
                    error = ', '.join(result['errors'])
                    return {'success': False, 'error': error}
                
                print(f"✅ Request sent - ID: {result['requestId']}")
                print(f"   ThreadId: {result.get('threadId')}")
                
                return {
                    'success': True,
                    'requestId': result['requestId'],
                    'threadId': result.get('threadId')
                }
                
        except Exception as e:
            print(f"❌ Error: {e}")
            return {'success': False, 'error': str(e)}
    
    # =========================================================================
    # WEBSOCKET STREAMING (Real-time)
    # =========================================================================
    
    async def _stream_response_websocket(
        self,
        user_id: str,
        client_subscription_id: str,
        on_chunk: Callable[[str], None],
        timeout: int = 60
    ) -> Optional[str]:
        """
        Stream response using GitLab ActionCable WebSocket.
        
        Returns the full response text, or None if WebSocket fails.
        """
        
        try:
            # SSL context for wss://
            ssl_context = ssl.create_default_context()
            
            async with websockets.connect(
                self.cable_url,
                extra_headers={
                    'Authorization': f'Bearer {self.gitlab_token}',
                    'Origin': self.gitlab_url
                },
                ssl=ssl_context
            ) as ws:
                
                # ActionCable handshake
                welcome = await asyncio.wait_for(ws.recv(), timeout=10)
                welcome_data = json.loads(welcome)
                
                if welcome_data.get('type') != 'welcome':
                    print(f"⚠️  Unexpected welcome: {welcome_data}")
                    return None
                
                # Subscribe to aiCompletionResponse channel
                subscribe_msg = {
                    "command": "subscribe",
                    "identifier": json.dumps({
                        "channel": "GraphqlChannel",
                        "query": """
                            subscription aiCompletionResponse($userId: UserID, $aiAction: AiAction, $clientSubscriptionId: String) {
                                aiCompletionResponse(userId: $userId, aiAction: $aiAction, clientSubscriptionId: $clientSubscriptionId) {
                                    content
                                    contentHtml
                                    errors
                                    role
                                    timestamp
                                    type
                                    chunkId
                                    requestId
                                }
                            }
                        """,
                        "variables": {
                            "userId": user_id,
                            "aiAction": "CHAT",
                            "clientSubscriptionId": client_subscription_id
                        }
                    })
                }
                
                await ws.send(json.dumps(subscribe_msg))
                
                # Wait for subscription confirmation
                confirm = await asyncio.wait_for(ws.recv(), timeout=10)
                confirm_data = json.loads(confirm)
                
                if confirm_data.get('type') == 'reject_subscription':
                    print(f"⚠️  Subscription rejected: {confirm_data}")
                    return None
                
                print("🔌 WebSocket streaming connected")
                
                # Collect response chunks
                full_response = ""
                start_time = asyncio.get_event_loop().time()
                
                while True:
                    try:
                        # Check timeout
                        if asyncio.get_event_loop().time() - start_time > timeout:
                            print("⏱️  WebSocket timeout")
                            break
                        
                        msg = await asyncio.wait_for(ws.recv(), timeout=5)
                        data = json.loads(msg)
                        
                        # Skip ping/pong
                        if data.get('type') in ['ping', 'pong']:
                            continue
                        
                        # Handle message
                        if data.get('message'):
                            result = data['message'].get('result', {}).get('data', {}).get('aiCompletionResponse', {})
                            
                            if result:
                                content = result.get('content', '')
                                msg_type = result.get('type', '')
                                
                                if content:
                                    # Stream chunk to callback
                                    on_chunk(content)
                                    full_response += content
                                
                                # Check if complete
                                if msg_type == 'FINAL_RESPONSE' or result.get('errors'):
                                    print("✅ Stream complete")
                                    break
                        
                    except asyncio.TimeoutError:
                        # No message for 5s - check if we have content
                        if full_response:
                            break
                        continue
                
                return full_response if full_response else None
                
        except Exception as e:
            print(f"⚠️  WebSocket error: {e}")
            return None
    
    # =========================================================================
    # POLLING FALLBACK (Simulated streaming)
    # =========================================================================
    
    async def _poll_for_response(
        self,
        request_id: str,
        thread_id: Optional[str],
        on_chunk: Optional[Callable[[str], None]] = None,
        max_attempts: int = 60,
        poll_interval: float = 0.5
    ) -> str:
        """
        Poll for response with optional simulated streaming.
        
        If on_chunk is provided, yields new content as it appears.
        """
        
        query = """
        query($threadId: AiConversationThreadID) {
            aiMessages(threadId: $threadId) {
                nodes {
                    requestId
                    content
                    role
                }
            }
        }
        """
        
        session = await self._get_session()
        last_content = ""
        
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
                    
                    messages = data.get('data', {}).get('aiMessages', {}).get('nodes', [])
                    
                    # Find assistant response for this request
                    assistant_msg = next(
                        (m for m in messages 
                         if m.get('role') == 'ASSISTANT' 
                         and m.get('requestId') == request_id
                         and m.get('content')),
                        None
                    )
                    
                    if assistant_msg:
                        content = assistant_msg['content']
                        
                        # Stream new content if callback provided
                        if on_chunk and len(content) > len(last_content):
                            new_content = content[len(last_content):]
                            on_chunk(new_content)
                            last_content = content
                        
                        # Check if response seems complete
                        if content and (
                            attempt > 5 or  # Give it a few polls
                            content.rstrip().endswith(('.', '!', '?', '```', '\n'))
                        ):
                            # One more poll to confirm no more content
                            await asyncio.sleep(poll_interval)
                            continue
                        
                        # After several stable polls, return
                        if attempt > 10 and content == last_content:
                            return content
                
                await asyncio.sleep(poll_interval)
                
            except Exception as e:
                print(f"⚠️  Poll error: {e}")
                await asyncio.sleep(poll_interval)
        
        return last_content or "Response timeout. Please try again."
    
    # =========================================================================
    # STREAMING GENERATOR (for async iteration)
    # =========================================================================
    
    async def stream_message(
        self,
        message: str,
        session_id: str,
        thread_id: Optional[str] = None
    ) -> AsyncGenerator[Dict, None]:
        """
        Stream chat response as async generator.
        
        Yields:
            Dict with 'type' (chunk/complete/error) and 'content'/'data'
        """
        
        if not self.enabled:
            yield {'type': 'error', 'content': 'GITLAB_TOKEN not configured'}
            return
        
        await self._ensure_user_id()
        
        # Use stored thread
        if not thread_id and session_id in self.thread_mappings:
            thread_id = self.thread_mappings[session_id]
        
        client_subscription_id = str(uuid.uuid4())
        
        # Send mutation
        result = await self._send_chat_mutation(
            message=message,
            thread_id=thread_id,
            client_subscription_id=client_subscription_id
        )
        
        if not result['success']:
            yield {'type': 'error', 'content': result.get('error', 'Unknown error')}
            return
        
        request_id = result['requestId']
        response_thread_id = result.get('threadId') or thread_id
        
        if response_thread_id:
            self.thread_mappings[session_id] = response_thread_id
        
        # Yield initial info
        yield {
            'type': 'start',
            'requestId': request_id,
            'threadId': response_thread_id
        }
        
        # Can't poll without threadId
        if not response_thread_id:
            print("⚠️ No threadId returned - cannot poll for response")
            yield {'type': 'error', 'content': 'No thread ID returned from GitLab'}
            return
        
        # Stream via polling (WebSocket is complex for generators)
        query = """
        query($threadId: AiConversationThreadID) {
            aiMessages(threadId: $threadId) {
                nodes { requestId content role }
            }
        }
        """
        
        print(f"🔄 Starting polling for threadId: {response_thread_id}")
        
        session = await self._get_session()
        last_content = ""
        stable_count = 0
        poll_count = 0
        initial_assistant_count = -1  # Track how many assistant messages existed before
        
        for _ in range(120):  # Max 60 seconds at 0.5s interval
            poll_count += 1
            try:
                async with session.post(
                    self.graphql_url,
                    json={"query": query, "variables": {"threadId": response_thread_id}}
                ) as response:
                    data = await response.json()
                    
                    if data.get('errors'):
                        print(f"❌ Poll error: {data['errors']}")
                    
                    messages = data.get('data', {}).get('aiMessages', {}).get('nodes', [])
                    
                    # Find all ASSISTANT messages with content
                    assistant_messages = [
                        m for m in messages 
                        if m.get('role') == 'ASSISTANT' and m.get('content')
                    ]
                    
                    # On first poll, record existing assistant message count
                    # (in case this is a continuing conversation with history)
                    if initial_assistant_count < 0:
                        # If there are assistant messages already, the NEW one will be at the end
                        # But it might not exist yet on first poll
                        initial_assistant_count = len(assistant_messages)
                        print(f"📊 Initial state: {len(messages)} total, {initial_assistant_count} assistant msgs")
                    
                    # Debug: show polling progress
                    if poll_count <= 5 or poll_count % 10 == 0:
                        print(f"📊 Poll #{poll_count}: {len(messages)} total, {len(assistant_messages)} assistant")
                    
                    # Look for a NEW assistant message (one that wasn't there initially,
                    # or the latest one if count increased)
                    if len(assistant_messages) > initial_assistant_count or (initial_assistant_count == 0 and assistant_messages):
                        # New assistant message appeared! Get the latest one
                        msg = assistant_messages[-1]
                        content = msg['content']
                        
                        if poll_count <= 3 or len(content) != len(last_content):
                            print(f"   ✅ Response: {len(content)} chars (was {len(last_content)})")
                        
                        if len(content) > len(last_content):
                            new_content = content[len(last_content):]
                            yield {'type': 'chunk', 'content': new_content}
                            last_content = content
                            stable_count = 0
                        else:
                            stable_count += 1
                        
                        # Response stable for 3 polls = complete
                        if stable_count >= 3 and last_content:
                            print(f"✅ Response complete: {len(last_content)} chars")
                            break
                
                await asyncio.sleep(0.5)
                
            except Exception as e:
                yield {'type': 'error', 'content': str(e)}
                break
        
        yield {
            'type': 'complete',
            'content': last_content,
            'threadId': response_thread_id,
            'requestId': request_id
        }
    
    # =========================================================================
    # UTILITY METHODS
    # =========================================================================
    
    def get_thread_id(self, session_id: str) -> Optional[str]:
        """Get thread ID for a session"""
        return self.thread_mappings.get(session_id)
    
    def clear_session(self, session_id: str):
        """Clear session data"""
        if session_id in self.thread_mappings:
            del self.thread_mappings[session_id]
    
    # =========================================================================
    # COMPATIBILITY METHODS (for existing code)
    # =========================================================================
    
    def add_session_context(self, session_id: str, analysis_data: Dict):
        """Add analysis context for a session (for log analysis integration)"""
        # Store context for potential use in prompts
        if not hasattr(self, 'session_contexts'):
            self.session_contexts = {}
        
        context = {
            'session_id': session_id,
            'services': list(set(
                f.get('service', 'unknown') 
                for f in analysis_data.get('log_files', {}).values()
            ))[:10] if analysis_data.get('log_files') else [],
            'timestamp': datetime.now().isoformat()
        }
        self.session_contexts[session_id] = context
        print(f"📝 Added context for session: {session_id}")
    
    def load_conversations(self, session_id: str) -> List[Dict]:
        """Load conversations for a session (compatibility method)"""
        file_path = self.storage_dir / f"{session_id}.json"
        if file_path.exists():
            try:
                with open(file_path, 'r') as f:
                    return [json.load(f)]
            except Exception as e:
                print(f"Error loading conversation: {e}")
        return []
    
    def create_log_search_query(self, natural_query: str, context: Dict) -> str:
        """Convert natural language to power search query"""
        import re
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
    
    async def get_thread_messages(self, thread_id: str) -> List[Dict]:
        """Load messages from a thread"""
        
        query = """
        query($threadId: AiConversationThreadID!) {
            aiMessages(threadId: $threadId) {
                nodes {
                    content
                    role
                    timestamp
                    requestId
                }
            }
        }
        """
        
        try:
            session = await self._get_session()
            async with session.post(
                self.graphql_url,
                json={"query": query, "variables": {"threadId": thread_id}}
            ) as response:
                data = await response.json()
                nodes = data.get('data', {}).get('aiMessages', {}).get('nodes', [])
                return [
                    {
                        'role': n['role'].lower(),
                        'content': n['content'],
                        'timestamp': n.get('timestamp')
                    }
                    for n in nodes if n.get('content')
                ]
        except Exception as e:
            print(f"❌ Error loading thread: {e}")
            return []


# =============================================================================
# COMPATIBILITY WRAPPER
# =============================================================================

class GitLabDuoChatIntegration(GitLabDuoChat):
    """Backwards-compatible wrapper"""
    
    async def send_chat_message(
        self,
        message: str,
        session_id: str,
        thread_id: Optional[str] = None,
        resource_id: Optional[str] = None,
        stream: bool = False
    ) -> Dict:
        """Compatible interface"""
        
        result = await self.send_message(
            message=message,
            session_id=session_id,
            thread_id=thread_id
        )
        
        return {
            'requestId': result.get('requestId', str(uuid.uuid4())),
            'threadId': result.get('threadId'),
            'clientSubscriptionId': str(uuid.uuid4()),
            'response': result.get('response'),
            'errors': [result['error']] if result.get('error') else [],
            'streaming': False
        }
    
    async def get_available_models(self) -> Dict:
        return {
            'defaultModel': {'name': 'claude-3-5-sonnet', 'displayName': 'Claude 3.5 Sonnet'},
            'availableModels': [
                {'name': 'claude-3-5-sonnet', 'displayName': 'Claude 3.5 Sonnet'}
            ],
            'error': None
        }


# =============================================================================
# TEST
# =============================================================================

async def test():
    """Test streaming"""
    
    chat = GitLabDuoChat()
    
    if not chat.enabled:
        print("❌ Set GITLAB_TOKEN to test")
        return
    
    print("\n🧪 Testing streaming...")
    
    # Test with callback
    chunks = []
    def on_chunk(chunk):
        print(chunk, end='', flush=True)
        chunks.append(chunk)
    
    result = await chat.send_message(
        "What is GitLab CI/CD in 2 sentences?",
        session_id="test",
        on_chunk=on_chunk
    )
    
    print(f"\n\n✅ Complete! Thread: {result.get('threadId')}")
    print(f"   Chunks received: {len(chunks)}")
    
    # Test generator
    print("\n🧪 Testing async generator...")
    
    async for event in chat.stream_message(
        "What is GitLab Runner?",
        session_id="test"
    ):
        if event['type'] == 'chunk':
            print(event['content'], end='', flush=True)
        elif event['type'] == 'complete':
            print(f"\n✅ Done!")
    
    await chat.close()


if __name__ == "__main__":
    asyncio.run(test())
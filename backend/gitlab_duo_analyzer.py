# gitlab_duo_rest_analyzer.py
import json
import os
import aiohttp
import asyncio
from typing import Dict, List, Optional
from datetime import datetime
from pathlib import Path

class GitLabDuoRESTAnalyzer:
    """Production-grade GitLab Duo analyzer using REST API with conversation tracking"""
    
    def __init__(self):
        # Match the working pattern from gitlab_duo_chat.py
        self.gitlab_token = os.environ.get('GITLAB_TOKEN') or os.environ.get('GITLAB_PAT')
        self.gitlab_url = os.environ.get('GITLAB_URL') or os.environ.get('GITLAB_INSTANCE_URL', 'https://gitlab.com')
        
        # Debug output
        if self.gitlab_token:
            print(f"✅ GitLab REST Analyzer: Token found (length: {len(self.gitlab_token)})")
            print(f"   URL: {self.gitlab_url}")
            self.enabled = True
        else:
            print("⚠️  GitLab REST Analyzer: GITLAB_TOKEN not found")
            print("   Checking environment...")
            print(f"   GITLAB_TOKEN in env: {'GITLAB_TOKEN' in os.environ}")
            print(f"   GITLAB_PAT in env: {'GITLAB_PAT' in os.environ}")
            print(f"   Available env vars with 'GITLAB': {[k for k in os.environ.keys() if 'GITLAB' in k]}")
            self.enabled = False
        
        # Storage
        self.storage_dir = Path("data/duo_rest_analysis")
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        
        # Batch configuration
        self.errors_per_batch = 15  # Errors per API call
        self.max_retries = 3
        self.timeout_seconds = 30
        
        # Conversation tracking
        self.active_conversations = {}  # session_id -> conversation_history
        
        print(f"✅ GitLab Duo REST Analyzer initialized")
        print(f"   URL: {self.gitlab_url}")
        print(f"   Enabled: {self.enabled}")
    
    def _save_session(self, session_id: str, data: Dict):
        """Save session data to disk"""
        file_path = self.storage_dir / f"{session_id}.json"
        with open(file_path, 'w') as f:
            json.dump(data, f, default=str, indent=2)
    
    def _load_session(self, session_id: str) -> Optional[Dict]:
        """Load session from disk"""
        file_path = self.storage_dir / f"{session_id}.json"
        if file_path.exists():
            try:
                with open(file_path, 'r') as f:
                    return json.load(f)
            except Exception as e:
                print(f"Error loading session: {e}")
        return None
    
    def clear_session(self, session_id: str) -> bool:
        """Clear analysis session completely"""
        try:
            # Clear memory
            if session_id in self.active_conversations:
                del self.active_conversations[session_id]
            
            # Clear disk
            file_path = self.storage_dir / f"{session_id}.json"
            if file_path.exists():
                file_path.unlink()
                print(f"✅ Cleared Duo REST analysis for session: {session_id}")
                return True
            return False
        except Exception as e:
            print(f"Error clearing session: {e}")
            return False
    
    def _prepare_batch_content(self, errors: List[Dict], batch_num: int, total_batches: int, is_first: bool = False) -> str:
        """Prepare content for a batch API call"""
        
        parts = []
        
        if is_first:
            parts.append(f"Analyze {len(errors)} GitLab errors (batch {batch_num}/{total_batches}):")
        else:
            parts.append(f"Batch {batch_num}/{total_batches}:")
        
        # Extremely concise format to fit in 1000 chars
        for i, error in enumerate(errors, 1):
            # Just the essentials
            msg = error.get('message', 'No message')[:100]  # Truncate to 100 chars
            parts.append(f"{i}. {error.get('severity', 'ERROR')} ({error.get('count', 1)}x): {msg}")
        
        content = '\n'.join(parts)
        
        # CRITICAL: Ensure we're under 1000 characters
        if len(content) > 950:
            # Truncate and add indicator
            content = content[:950] + "..."
        
        return content
    
    def _prepare_final_analysis_prompt(self, total_errors: int, total_patterns: int, all_batch_responses: List[str]) -> str:
        """Prepare the final comprehensive analysis request"""
        
        # Combine insights from all batches
        combined_insights = "\n".join([
            f"Batch {i+1}: {resp[:150]}" 
            for i, resp in enumerate(all_batch_responses) 
            if resp
        ])[:400]  # Limit combined insights
        
        prompt = f"""Based on {total_patterns} GitLab errors ({total_errors} total):

Previous analysis:
{combined_insights}

Provide:
1. Top 3 critical fixes
2. Root cause
3. Immediate actions

Be specific."""
        
        # Ensure under 1000 chars
        if len(prompt) > 950:
            prompt = prompt[:950] + "..."
        
        return prompt
    
    async def call_duo_api(self, content: str, session_id: str, attempt: int = 1) -> Optional[Dict]:
        """Call GitLab Duo REST API with retry logic"""
        
        url = f"{self.gitlab_url}/api/v4/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.gitlab_token}",
            "Content-Type": "application/json"
        }
        
        # Add conversation context if we want to maintain history
        data = {
            "content": content,
            # "with_clean_history": False  # Keep conversation context
        }
        
        try:
            print(f"  📤 Calling Duo API (attempt {attempt}/{self.max_retries})...")
            
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url, 
                    json=data, 
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=self.timeout_seconds)
                ) as response:
                    
                    # Accept both 200 and 201 as success
                    if response.status in [200, 201]:
                        result = await response.text()
                        # The API returns a string directly, not JSON
                        print(f"  ✅ API call successful (status {response.status})")
                        return {
                            "response": result,
                            "status": "success",
                            "timestamp": datetime.now().isoformat()
                        }
                    else:
                        error_text = await response.text()
                        print(f"  ❌ API error {response.status}: {error_text}")
                        
                        if attempt < self.max_retries:
                            await asyncio.sleep(2 ** attempt)  # Exponential backoff
                            return await self.call_duo_api(content, session_id, attempt + 1)
                        
                        return None
                        
        except asyncio.TimeoutError:
            print(f"  ⏱️ API call timed out")
            if attempt < self.max_retries:
                await asyncio.sleep(2 ** attempt)
                return await self.call_duo_api(content, session_id, attempt + 1)
            return None
            
        except Exception as e:
            print(f"  ❌ API call failed: {e}")
            if attempt < self.max_retries:
                await asyncio.sleep(2 ** attempt)
                return await self.call_duo_api(content, session_id, attempt + 1)
            return None
    
    async def analyze_errors_with_batching(self, session_id: str, error_groups: List[Dict]) -> Dict:
        """Analyze errors individually using REST API - one error at a time for best results"""
        
        # Check for cached results
        existing = self._load_session(session_id)
        if existing and existing.get('status') == 'completed':
            print(f"♻️ Using cached analysis for session: {session_id}")
            return existing
        
        if not self.enabled:
            return {
                'status': 'failed',
                'error': 'GitLab Duo not configured. Set GITLAB_TOKEN environment variable.'
            }
        
        # Initialize session
        session_data = {
            'status': 'processing',
            'session_id': session_id,
            'started_at': datetime.now().isoformat(),
            'total_errors': sum(e.get('count', 0) for e in error_groups),
            'unique_patterns': len(error_groups),
            'patterns_total': len(error_groups),
            'patterns_analyzed': 0,
            'current_message': 'Starting analysis...',
            'analyses': []  # Store individual analyses
        }
        
        try:
            print(f"\n{'='*60}")
            print(f"🚀 GITLAB DUO AI ANALYSIS")
            print(f"📊 Total errors: {session_data['total_errors']}")
            print(f"📋 Analyzing {session_data['unique_patterns']} error patterns individually")
            print(f"{'='*60}\n")
            
            # Save initial state
            self._save_session(session_id, session_data)
            
            # Analyze each error pattern individually
            for idx, error in enumerate(error_groups, 1):
                print(f"� Analyzing Pattern {idx}/{len(error_groups)}")
                
                session_data['current_message'] = f"Analyzing pattern {idx}/{len(error_groups)}..."
                session_data['patterns_analyzed'] = idx - 1
                self._save_session(session_id, session_data)
                
                # Prepare detailed prompt for this specific error
                prompt = self._prepare_individual_error_prompt(error, idx, len(error_groups))
                
                # Call API
                result = await self.call_duo_api(prompt, f"{session_id}_pattern_{idx}")
                
                if result and result['status'] == 'success':
                    # Store the analysis
                    analysis = {
                        'pattern_number': idx,
                        'error': {
                            'component': error.get('component', 'Unknown'),
                            'severity': error.get('severity', 'ERROR'),
                            'count': error.get('count', 1),
                            'message': error.get('message', 'No message')[:200],
                            'files': error.get('files', [])[:3]
                        },
                        'analysis': result['response'],
                        'timestamp': result['timestamp']
                    }
                    
                    session_data['analyses'].append(analysis)
                    
                    print(f"  ✅ Pattern {idx} analyzed")
                    print(f"  📝 {result['response'][:100]}...")
                else:
                    print(f"  ⚠️ Pattern {idx} analysis failed")
                    session_data['analyses'].append({
                        'pattern_number': idx,
                        'error': {
                            'component': error.get('component', 'Unknown'),
                            'severity': error.get('severity', 'ERROR'),
                            'count': error.get('count', 1),
                            'message': error.get('message', 'No message')[:200]
                        },
                        'analysis': 'Analysis failed - API error',
                        'failed': True
                    })
                
                # Small delay between calls to avoid rate limiting
                if idx < len(error_groups):
                    await asyncio.sleep(0.5)
            
            session_data['patterns_analyzed'] = len(error_groups)
            
            # Mark as completed
            session_data.update({
                'status': 'completed',
                'completed_at': datetime.now().isoformat(),
                'current_message': 'Analysis completed successfully!',
                'summary': {
                    'total_patterns': len(error_groups),
                    'successful_analyses': len([a for a in session_data['analyses'] if not a.get('failed', False)]),
                    'failed_analyses': len([a for a in session_data['analyses'] if a.get('failed', False)])
                }
            })
            
            # Save final state
            self._save_session(session_id, session_data)
            
            print(f"\n{'='*60}")
            print(f"✅ Analysis complete!")
            print(f"   Patterns analyzed: {session_data['summary']['successful_analyses']}/{len(error_groups)}")
            print(f"{'='*60}\n")
            
            return session_data
            
        except Exception as e:
            print(f"❌ Analysis failed: {e}")
            import traceback
            traceback.print_exc()
            
            session_data.update({
                'status': 'failed',
                'error': str(e),
                'current_message': f'Error: {str(e)}'
            })
            self._save_session(session_id, session_data)
            
            return session_data
    
    def _prepare_individual_error_prompt(self, error: Dict, pattern_num: int, total_patterns: int) -> str:
        """Prepare a detailed prompt for analyzing a single error pattern"""
        
        component = error.get('component', 'Unknown')
        severity = error.get('severity', 'ERROR')
        count = error.get('count', 1)
        message = error.get('message', 'No message')[:300]
        
        # Get sample if available
        sample_info = ""
        if error.get('samples') and len(error['samples']) > 0:
            sample = error['samples'][0]
            if sample.get('full_line'):
                sample_info = f"\nSample: {sample['full_line'][:200]}"
        
        prompt = f"""GitLab Error Pattern {pattern_num}/{total_patterns}

Component: {component}
Severity: {severity}
Occurrences: {count}

Error: {message}{sample_info}

Analyze indepth dude exteremely accurate by checking code and docs latest and be very indepth technical with extreme details depeding on the log be smart:
1. Root cause explain what this error mean and analyze docs and code for accuracy
2. Impact
3. Fix (specific commands/config)
4. Prevention"""
        
        # Ensure under 1000 chars
        if len(prompt) > 950:
            prompt = prompt[:950] + "..."
        
        return prompt
    
    def get_session_status(self, session_id: str) -> Optional[Dict]:
        """Get current analysis status"""
        return self._load_session(session_id)
    
    async def test_connection(self) -> bool:
        """Test GitLab Duo API connection"""
        if not self.enabled:
            return False
        
        try:
            result = await self.call_duo_api("Hello, can you hear me?", "test")
            return result is not None
        except:
            return False

# Global instance
duo_rest_analyzer = GitLabDuoRESTAnalyzer()
# 🚀 GitLab SOS Analyzer

AI-powered log analyzer with advanced search features for GitLab SOS archives.

![image](https://gitlab.com/uploads/-/system/personal_snippet/4885492/c1809191e6223af9dc1e44a91c07dbd2/soslab.png)

## What Makes This Special?

**Smart Log Analysis That Actually Works**
- Clean, intuitive interface for viewing SOS archives
- Drag & drop multiple archives - each gets its own tab that you can rename by double-clicking
- PowerSearch with natural language - search like you think, not like a robot
- Visual query builder for complex searches
- Switch between traditional log view and structured table format
- **Dark mode support** for those late-night troubleshooting sessions

**AI-Powered Analysis**
- Auto-analysis that scans for GitLab error patterns (takes a few minutes to run, but you can navigate other tabs or chat with Duo while it works)
- Embedded GitLab Duo Chat for interactive log analysis
- MCP server integration - your VS Code Duo Chat gets superpowers for SOS analysis
- Hundreds of pre-configured GitLab error patterns from docs and codebase

**Built for Real Work**
- One command to rule them all - `python start.py` and you're done
- Built-in fast stats - no more switching to terminal
- Real-time service monitoring
- Cross-platform support (macOS, Linux, Windows)

---

## Demo Video

![soslab-demo](https://gitlab.com/uploads/-/system/personal_snippet/4885492/d1cb85a526e73bbb7be62de1fb3232d9/soslab-low.gif)


## Before You Start

You'll need these installed on your machine:

**Python 3.8+** and **Node.js 16+**

### Quick Install Links:

| Platform | Python | Node.js |
|----------|--------|----------|
| **macOS** | [Download](https://www.python.org/downloads/macos/) or `brew install python` | [Download](https://nodejs.org/en/download/package-manager#macos) or `brew install node` |
| **Windows** | [Download](https://www.python.org/downloads/windows/) | [Download](https://nodejs.org/en/download/prebuilt-installer) |
| **Linux** | [Download](https://www.python.org/downloads/source/) | [Download](https://nodejs.org/en/download/package-manager) |

---

## Getting Started (The Easy Way)

### 1. Grab the Code
```bash
git clone https://gitlab.com/gitlab-com/support/toolbox/soslab.git
cd soslab
```

### 2. One Command to Start Everything
```bash
python start.py
```

Seriously, that's it! The script handles everything:
- ✅ Installs Python dependencies
- ✅ Installs frontend packages  
- ✅ Starts backend server (port 8000)
- ✅ Starts MCP server (port 8080)
- ✅ Starts frontend UI (port 3000)

### What You'll See
```
======================================================================
🚀 GitLab SOS Analyzer - Smart One-Click Start
======================================================================

🔍 Checking installation...
✅ Python packages already installed
✅ Frontend packages already installed
⚡ Fast startup - everything already installed (0.3s)

======================================================================
Starting Services:
----------------------------------------------------------------------

🚀 Starting Backend...
   ✅ Backend ready on http://localhost:8000
🤖 Starting MCP Server...
   ✅ MCP ready on http://localhost:8080
🌐 Starting Frontend...
   ⏳ Waiting for frontend to start...
   ✅ Frontend ready on http://localhost:3000

======================================================================
🎉 GitLab SOS Analyzer is Running!
======================================================================

📊 Services Status:
----------------------------------------------------------------------
✅ Backend API:  http://localhost:8000
✅ MCP Server:   http://localhost:8080
✅ Frontend UI:  http://localhost:3000
======================================================================

🌟 Open your browser to: http://localhost:3000

🛑 Press Ctrl+C to stop all services
======================================================================

💚 All systems operational. Monitoring services...
```

---

## Using the Analyzer

### Getting Your SOS Archives In

> **💡 Pro Tip**: Drag & drop works way better than the file picker! While you can use file selection, drag & drop gives you the most reliable upload experience.

1. Open `http://localhost:3000` in your browser
2. Drag your SOS archive files right onto the page
3. Each archive gets its own tab - double-click the tab name to rename it (super helpful for multi-node setups)
4. Start exploring!

### PowerSearch - Search Like a Human

No need to learn complex query languages. Just search naturally:

#### Query Syntax Examples:

```bash
# Service and severity filtering
service:rails,sidekiq AND severity:error

# Simple text search
error
# Find lines containing "error"

# Exact field matching
status:500
# Exact match for status field

# Comparison operators
status>=500
# Status greater than or equal to 500

# Wildcards
service:rail*
# Service starting with "rail"

# Multiple services
service:rails,sidekiq
# Rails OR Sidekiq service

# Multiple values
status:500,502,503
# Multiple status codes

# Nested service paths
service:rails:prod*
# Rails production logs

# Path wildcards
path:/api/*/users
# Wildcard in path

# Boolean combinations
error AND status:500
# Both conditions must match

error OR warning
# Either condition matches

NOT level:debug
# Exclude debug logs

# Exact phrases
"exact phrase"
# Match exact phrase
```

**Available Operators:**
- `:` `=` `!=` `>` `<` `>=` `<=` `~` (contains) `=~` (regex)

**Wildcards:**
- `*` (any characters) `?` (single character)

**Multiple Values:**
- Use commas to match any of multiple values (e.g., `service:rails,sidekiq,gitaly`)

### View Your Data Your Way

- **📄 Log View**: Traditional log format with syntax highlighting
- **📊 Table View**: Structured data in sortable columns
- **🔍 Search Results**: Filtered entries with highlighting
- **🌙 Dark Mode**: Easy on the eyes for long troubleshooting sessions

---

## AI Integration

### Embedded Duo Chat

**Setup:**
```bash
# Set your GitLab PAT before starting
export GITLAB_PAT="glpat-YOUR_ACTUAL_TOKEN_HERE"
python start.py
```

Now you can paste error logs directly into the embedded chat and get real-time analysis and suggestions.

### VS Code Integration (The Cool Part)

The app automatically starts an MCP server that gives your VS Code Duo Chat superpowers for SOS analysis.

**Setup:**

1. **Configure MCP on your machine:**
   ```bash
   mkdir -p ~/.gitlab/duo
   
   cat > ~/.gitlab/duo/mcp.json << EOF
   {
     "mcpServers": {
       "local-http-server": {
         "url": "http://localhost:8080/mcp"
       }
     }
   }
   EOF
   ```

2. **Restart VS Code**

3. **Test it**: In VS Code Duo Chat, type "list tools" - you should see all the SOS analysis tools

**Try asking Duo things like:**
- "Analyze the PostgreSQL logs in the uploaded archive"
- "Show me the top errors across all nodes"
- "Compare error patterns between the two archives I uploaded"

Duo will autonomously use the MCP tools to dig through your SOS archives and give you insights.

---

## A Few Things to Know

### Auto Analysis
When you upload archives, the auto-analysis kicks off automatically. **It takes a few minutes to run** (we're scanning through potentially thousands of log entries), but you can navigate to other tabs or chat with Duo while it works in the background.

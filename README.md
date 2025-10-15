# 🚀 GitLab SOS Analyzer

AI-powered log analyzer with advanced search features for GitLab SOS archives.

![image](https://gitlab.com/uploads/-/system/personal_snippet/4885492/c1809191e6223af9dc1e44a91c07dbd2/soslab.png)

---

## 📋 Quick Navigation

- 🎬 [Demo Video](#demo-video)
- 🚀 [Getting Started](#getting-started-the-easy-way)
- 📦 [Prerequisites](#before-you-start)
- 💡 [Key Features](#what-makes-this-special)
- 📈 [System Metrics Dashboard](#system-metrics-dashboard)
- 🔍 [PowerSearch Guide](#powersearch---search-like-a-human)
- 🤖 [AI Integration](#ai-integration)
- 📊 [Using the Analyzer](#using-the-analyzer)


---

## What Makes This Special?

**Smart Log Analysis**
- Clean, intuitive interface for viewing SOS archives
- Drag & drop/upload multiple archives - each gets its own tab that you can rename by double-clicking
- PowerSearch: search logs usin easy queries
- Visual query builder for complex search queries
- Switch between traditional log view and structured table format and raw json view
- Log viewer with inline search and filter options for quick search


**Auto Analysis**
- Auto-analysis that scans for GitLab hundreds of error patterns (takes a few minutes to run, but you can navigate other tabs or chat with Duo while it works)
- Embedded GitLab Duo Chat for interactive log analysis
- MCP server integration - your VS Code Duo Chat gets superpowers for SOS analysis
- Hundreds of pre-configured GitLab error patterns from docs and codebase
- Built-in fast stats - no more switching to terminal



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

**Debug mode:**

```
python start.py --debug 
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

1. Open `http://localhost:3000` in your browser
2. Drag or upload your SOS archive files right onto the page
3. Each archive gets its own tab - double-click the tab name to rename it (super helpful for multi-node setups)
4. Start exploring!

### PowerSearch - Search Like a Human

No need to learn complex query languages. Just search naturally using boolean operators 

#### Query Syntax Examples:

```bash
# Service and severity filtering
service:rails,sidekiq AND severity:error

# Specific file in rails
service:rails:production_json

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
- **🌙 Dark Mode**: Easy on the eyes 

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

### System Metrics Dashboard

Get instant visibility into system health across all your nodes:

#### Default parsed view: 

![Screenshot_2025-10-15_at_7.36.39_AM](/uploads/5a1fe7de75992c473e759bad23eb41ee/Screenshot_2025-10-15_at_7.36.39_AM.png)

![Screenshot_2025-10-15_at_7.37.20_AM](/uploads/08fb40c4affb6d127e6514b75a1499d5/Screenshot_2025-10-15_at_7.37.20_AM.png)

#### Raw logs viewer: 

![Screenshot_2025-10-15_at_7.38.50_AM](/uploads/28af12964f6381a1dee1249e5d709f02/Screenshot_2025-10-15_at_7.38.50_AM.png)



**Parsed Metrics View:**
- **System Overview**: Load average, CPU usage, memory utilization, disk space at a glance
- **Process Monitoring**: Top CPU and memory consuming processes with detailed stats
- **Critical Alerts**: Automatic highlighting of zombies, high resource usage, and disk space issues
- **Quick Stats**: vmstat, free, df, uptime - all parsed and visualized

**Raw Logs View:**
- Access original command output for detailed analysis
- 31+ system commands available (top, vmstat, free, df, uptime, and more)
- Switch between parsed and raw views instantly

Perfect for quickly identifying performance bottlenecks, resource constraints, and system health issues across multi-node GitLab deployments.


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

![image2](https://gitlab.com/uploads/-/system/personal_snippet/4885492/13bc9633aaad1b0204068e816689f325/Screenshot_2025-09-17_at_2.32.24_PM.png)

---

## A Few Things to Know

### Auto Analysis
 **It takes a few minutes to run** (we're scanning through potentially thousands of log entries), but you can navigate to other tabs or chat with Duo while it works in the background.

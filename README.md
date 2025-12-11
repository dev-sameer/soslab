# 🚀 SOS Lab - Static Log Analysis for GitLab Troubleshooting

**Simple, focused, powerful log analysis tool for GitLab infrastructure troubleshooting.**

AI-powered log analyzer with advanced search, pattern clustering, and correlation tracing for GitLab SOS archives and custom logs.

<img width="1728" height="915" alt="Screenshot 2025-12-11 at 9 36 33 AM" src="https://github.com/user-attachments/assets/0e1026c6-9d0f-4ffc-9507-f39fda9e6247" />
<img width="1728" height="906" alt="Screenshot 2025-12-11 at 9 35 24 AM" src="https://github.com/user-attachments/assets/87d76a2c-9220-495c-9cb3-c2184150f5e4" />



---

## 📋 Quick Navigation

- 🚀 [Getting Started](#getting-started-the-easy-way)
- 📦 [Prerequisites](#before-you-start)
- 💡 [Why SOS Lab?](#why-sos-lab)
- ✨ [Key Features](#key-features)
- 📈 [System Metrics Dashboard](#system-metrics-dashboard)
- 🔍 [PowerSearch Guide](#powersearch---search-like-a-human)
- 📊 [Log Aggregation](#log-aggregation---pattern-clustering)
- 🔗 [Log Tracer](#log-tracer---correlation-timeline)
- 🤖 [AI Integration](#ai-integration)
- 📊 [Using the Analyzer](#using-the-analyzer)

---

## Why SOS Lab?

### The Problem

In high-availability GitLab setups with many nodes, troubleshooting is painful:
- Collecting logs from 30+ nodes results in massive SOS bundles
- Manually navigating through thousands of log files is time-consuming and error-prone
- Enterprise solutions like Elasticsearch and Kibana are overkill for static log analysis and introduce significant operational overhead
- These streaming platforms are designed for real-time log ingestion, not post-incident analysis or quick log dives

### The Solution

SOS Lab fills this gap by providing a **simple, focused tool for analyzing collected static logs** without the complexity and overhead of full-featured log platforms. It's designed specifically for GitLab troubleshooting workflows but can be extended to prett much any log file analysis

### Key Benefits

- **No infrastructure overhead** - runs locally or on modest hardware
- **Fast pattern detection** - 10,000 logs become 20-30 patterns instantly
- **Multi-node support** - analyze logs from 30+ nodes in one place
- **Flexible sessions** - add/remove files without re-uploading
- **Cost-effective** - no streaming costs, no vendor lock-in
- **Built for GitLab** - understands GitLab logs, services, and workflows

---

## Key Features

### 1. **Adding or Removing Files in Sessions**

<img width="982" height="738" alt="Screenshot 2025-12-10 at 1 36 31 PM" src="https://github.com/user-attachments/assets/9cdf23d5-dc09-4afd-9968-2a6d022f958e" />


SOSLab sessions are no longer static. Dynamically manage log files within a session:
- **Add new files** to an existing session without re-uploading the entire SOS bundle
- **Remove unnecessary files** to focus on relevant logs
- **Customize sessions** on the fly based on your investigation needs
- Perfect for iterative troubleshooting where you discover new log files to analyze

### 2. **Custom Sessions**

<img width="1728" height="909" alt="Screenshot 2025-12-10 at 1 40 25 PM" src="https://github.com/user-attachments/assets/9f2e8083-e77d-4c23-9b5d-2b20d7d54785" />


Not all troubleshooting involves full SOS bundles. Create flexible sessions:
- **Create empty custom sessions** and add only the log files you need
- **Collect specific logs** like `gitlab-ctl tail` output, application logs, or system logs
- **Work with any log type** - JSON, syslog, plain text, or mixed formats
- **No SOS bundle required** - use SOS Lab for any static log analysis scenario
- Enables the tool to be a general-purpose log analysis platform, not just for SOS bundles

### 3. **Log Aggregation (Pattern Clustering)**

<img width="1728" height="999" alt="Screenshot 2025-12-10 at 1 49 32 PM" src="https://github.com/user-attachments/assets/617c616f-a5bd-4e3e-a4f1-40e2564f7272" />


One of the most powerful features for handling large log volumes:
- **Automatic pattern detection** - groups similar log entries into patterns using Drain clustering
- **Reduces noise** - 10,000 error logs become 20-30 distinct patterns
- **Complete overview at a glance** - understand what's happening across all sessions instantly
- **Handles recurring log types** - identifies that most errors are variations of a few root causes
- **Multi-session support** - aggregate logs across all 30 nodes to see the big picture

### 4. **Log Tracer (Correlation ID Timeline)**



Trace request flows across different log types and services:
- **Search by correlation ID** - similar to Kibana's correlation dashboard
- **Chronological ordering** - automatically detects timestamps across different log formats (JSON, syslog, etc.)
- **Handles mixed log types** - GitLab uses multiple log formats with inconsistent timestamp structures; the tracer normalizes them
- **Timeline visualization** - see the exact sequence of events across services
- **LLM-friendly output** - copy and paste results directly to AI models for analysis while troubleshooting

### 5. **Troubleshooting Slate**



A lightweight sticky notes feature for quick note-taking:
- **Store correlation IDs, error codes, or observations** without leaving the app
- **Persistent storage** - notes remain until you explicitly clear them
- **Draggable, resizable, and minimizable** - customize the workspace to your needs
- **Quick reference** - keep important information visible while analyzing logs

### 6. **Terminal Integration**

<img width="1728" height="1002" alt="Screenshot 2025-12-10 at 1 57 58 PM" src="https://github.com/user-attachments/assets/0142793e-46fe-4ef3-9718-58d68709c8ac" />


Full terminal access without leaving the application:
- **In-app terminal** - tinker, run commands, or troubleshoot via the command line
- **Full shell functionality** - execute scripts, grep logs, or run diagnostic tools
- **Seamless workflow** - no context switching between the UI and terminal
- **Custom experience** - combine UI analysis with command-line power

### 7. **Smart Log Analysis**

Clean, intuitive interface for viewing SOS archives:
- **Drag & drop/upload** multiple archives - each gets its own tab that you can rename by double-clicking
- **PowerSearch** - search logs using easy, human-readable queries
- **Visual query builder** - for complex search queries
- **Multiple view modes** - switch between traditional log view, structured table format, and raw JSON view
- **Inline search and filter** - quick search options for rapid exploration

### 8. **Auto-Analysis with GitLab Duo**

AI-powered analysis of error patterns:
- **Selective analysis** - choose which error patterns to analyze
- **Detailed insights** - get AI-generated explanations for each pattern
- **Single-session focus** - excellent for deep-dive analysis of specific issues
- **Hundreds of pre-configured patterns** - from GitLab docs and codebase
- **Embedded Duo Chat** - interactive log analysis without leaving the app
- **MCP server integration** - your VS Code Duo Chat gets superpowers for SOS analysis

### 9. **System Metrics Dashboard**

Get instant visibility into system health across all your nodes:
- **Parsed metrics view** - load average, CPU usage, memory, disk space at a glance
- **Process monitoring** - top CPU and memory consuming processes
- **Critical alerts** - automatic highlighting of zombies, high resource usage, disk space issues
- **Raw logs view** - access original command output for detailed analysis
- **31+ system commands** - top, vmstat, free, df, uptime, and more



---


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

No need to learn complex query languages. Just search naturally using boolean operators and field-based filtering. 

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

## Log Aggregation - Pattern Clustering

One of the most powerful features for handling large log volumes. Instead of manually reviewing thousands of logs, SOS Lab automatically groups similar entries into patterns:

**How it works:**
- Analyzes all logs across all sessions
- Groups similar entries into patterns using intelligent clustering (Drain algorithm)
- Extracts common templates from recurring logs
- Shows you the top patterns by frequency

**Example:**
- Input: 10,000 error logs from 30 nodes
- Output: 20-30 distinct patterns with counts
- Benefit: Instantly see what's actually happening instead of drowning in noise

**Perfect for:**
- Multi-node troubleshooting
- Understanding error distribution
- Identifying systemic issues
- Getting a complete overview at a glance

---

## Log Tracer - Correlation Timeline

Trace request flows across different log types and services using correlation IDs:

**How it works:**
- Search for a correlation ID
- Automatically detects timestamps across different log formats (JSON, syslog, etc.)
- Normalizes timestamps from inconsistent formats
- Shows results in chronological order

**Why it's different from grep:**
- Normal grep shows results as it finds them (not chronological)
- GitLab uses multiple log formats with inconsistent timestamps
- Log Tracer normalizes and orders them by actual time
- Perfect for understanding the sequence of events

**Perfect for:**
- Following a request through multiple services
- Understanding the timeline of an incident
- Feeding results to LLMs for analysis
- Correlating events across different log types

---

## AI Integration

### Embedded Duo Chat

**Setup:**
```bash
# Set your GitLab token before starting (new)
export GITLAB_TOKEN="glpat-YOUR_ACTUAL_TOKEN_HERE"
python start.py
```

```bash
# Set your GitLab token before starting (old method using GITLAB_PAT)
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

// Package handlers — subagent.go: 5 sub-agents per v0.3 spec §17
//
// Each sub-agent is a higher-level orchestrator that composes the
// primitive IPC methods (sandbox.exec, file.*, research.*, agent.*,
// skill.*, etc.) into a single named workflow. This is the
// "brain" of the system: 5 sub-agents correspond to the 5 main
// capabilities that the master agent invokes.
//
// 1. research sub-agent     — multi-step deep research with retry/citation
// 2. agent-runner sub-agent — orchestrate agent runs with chaining
// 3. skill-loader sub-agent — load skill + execute its commands safely
// 4. sandbox-exec sub-agent — policy-wrapped command execution
// 5. file-ops sub-agent     — atomic file operations (move/copy/delete/search)
package handlers

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// ============================================================================
// 1. research sub-agent — subagent.research
// ============================================================================

// SubagentResearchParams — input to the research sub-agent
type SubagentResearchParams struct {
	Query       string `json:"query"`
	Depth       int    `json:"depth"`        // 1-5, number of sub-queries
	MaxResults  int    `json:"max_results"`  // per sub-query
	CiteSources bool   `json:"cite_sources"` // include source URLs
}

// SubagentResearchResult — aggregated research output
type SubagentResearchResult struct {
	Query      string                   `json:"query"`
	SubQueries []string                 `json:"sub_queries"`
	Findings   []map[string]interface{} `json:"findings"`
	Citations  []string                 `json:"citations,omitempty"`
	DurationMs int64                    `json:"duration_ms"`
}

func SubagentResearch(raw json.RawMessage) (interface{}, error) {
	var p SubagentResearchParams
	if err := json.Unmarshal(rawOrEmptyHelper(raw), &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}
	if p.Query == "" {
		return nil, fmt.Errorf("query is required")
	}
	if p.Depth == 0 {
		p.Depth = 2
	}
	if p.MaxResults == 0 {
		p.MaxResults = 5
	}
	start := time.Now()
	// Generate sub-queries (Phase 4: replace with real query decomposition)
	subs := make([]string, p.Depth)
	for i := 0; i < p.Depth; i++ {
		subs[i] = fmt.Sprintf("%s (角度 %d/%d)", p.Query, i+1, p.Depth)
	}
	// Aggregate findings (Phase 3: mock; Phase 4: dispatch to research.run)
	findings := make([]map[string]interface{}, 0, len(subs))
	var citations []string
	for i, sq := range subs {
		findings = append(findings, map[string]interface{}{
			"sub_query": sq,
			"snippet":   fmt.Sprintf("Findings for sub-query #%d: %s", i+1, sq),
			"score":     0.9 - float64(i)*0.1,
		})
		if p.CiteSources {
			citations = append(citations, fmt.Sprintf("https://example.com/ref-%d", i+1))
		}
	}
	return SubagentResearchResult{
		Query:      p.Query,
		SubQueries: subs,
		Findings:   findings,
		Citations:  citations,
		DurationMs: time.Since(start).Milliseconds(),
	}, nil
}

// ============================================================================
// 2. agent-runner sub-agent — subagent.run_agent
// ============================================================================

// SubagentRunAgentParams
type SubagentRunAgentParams struct {
	AgentID     string                 `json:"agent_id"`
	Input       map[string]interface{} `json:"input"`
	WaitResult  bool                   `json:"wait_result"`  // block until done
	TimeoutMs   int                    `json:"timeout_ms"`   // for WaitResult
	ChainWith   []string               `json:"chain_with"`   // agents to run after
}

// SubagentRunAgentResult
type SubagentRunAgentResult struct {
	ID         string                 `json:"id"`
	AgentID    string                 `json:"agent_id"`
	Status     string                 `json:"status"`
	Output     map[string]interface{} `json:"output,omitempty"`
	ChainedIDs []string               `json:"chained_ids,omitempty"`
}

func SubagentRunAgent(raw json.RawMessage) (interface{}, error) {
	var p SubagentRunAgentParams
	if err := json.Unmarshal(rawOrEmptyHelper(raw), &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}
	if p.AgentID == "" {
		return nil, fmt.Errorf("agent_id is required")
	}
	// Phase 3: generate a synthetic job id; Phase 4: dispatch to agent.run
	id := newID()
	// For Phase 3, mark as done immediately when WaitResult
	status := "queued"
	var output map[string]interface{}
	if p.WaitResult {
		// Simulate completion
		time.Sleep(100 * time.Millisecond)
		status = "done"
		output = map[string]interface{}{
			"summary": fmt.Sprintf("Mock output from %s", p.AgentID),
			"tokens":  1234,
		}
	}
	// Chain with other agents (record ids; Phase 4 will dispatch)
	var chained []string
	for _, a := range p.ChainWith {
		chained = append(chained, newID()+":"+a)
	}
	return SubagentRunAgentResult{
		ID:         id,
		AgentID:    p.AgentID,
		Status:     status,
		Output:     output,
		ChainedIDs: chained,
	}, nil
}

// ============================================================================
// 3. skill-loader sub-agent — subagent.apply_skill
// ============================================================================

// SubagentApplySkillParams
type SubagentApplySkillParams struct {
	SkillID string                 `json:"skill_id"`
	Input   map[string]interface{} `json:"input"`
}

// SubagentApplySkillResult
type SubagentApplySkillResult struct {
	SkillID   string                 `json:"skill_id"`
	Manifest  string                 `json:"manifest"`
	Output    map[string]interface{} `json:"output"`
	Applied   bool                   `json:"applied"`
	ErrorMsg  string                 `json:"error,omitempty"`
}

func SubagentApplySkill(raw json.RawMessage) (interface{}, error) {
	var p SubagentApplySkillParams
	if err := json.Unmarshal(rawOrEmptyHelper(raw), &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}
	if p.SkillID == "" {
		return nil, fmt.Errorf("skill_id is required")
	}
	// Reject obviously bad ids
	if strings.ContainsAny(p.SkillID, "/\\") || strings.Contains(p.SkillID, "..") || strings.HasPrefix(p.SkillID, ".") {
		return nil, fmt.Errorf("invalid skill id")
	}
	// Look up skill via SkillLoad (call into our own store via closure)
	store := NewSkillStore()
	loadJSON, _ := json.Marshal(map[string]string{"id": p.SkillID})
	loaded, err := SkillLoad(store)(loadJSON)
	if err != nil {
		return SubagentApplySkillResult{
			SkillID:  p.SkillID,
			Applied:  false,
			ErrorMsg: err.Error(),
		}, nil
	}
	loadedMap, _ := loaded.(SkillLoadResult)
	// "Apply" the skill — Phase 3: just echo the manifest
	// Phase 4: parse the manifest for commands, execute them with sandbox.exec
	return SubagentApplySkillResult{
		SkillID:  p.SkillID,
		Manifest: loadedMap.Manifest,
		Output: map[string]interface{}{
			"name":        loadedMap.Name,
			"description": loadedMap.Description,
			"input_keys":  mapKeys(p.Input),
			"manifest_lines": strings.Count(loadedMap.Manifest, "\n"),
		},
		Applied: true,
	}, nil
}

func mapKeys(m map[string]interface{}) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// ============================================================================
// 4. sandbox-exec sub-agent — subagent.exec_safe
// ============================================================================

// SubagentExecParams
type SubagentExecParams struct {
	Command     string   `json:"command"`
	Args        []string `json:"args"`
	Workdir     string   `json:"workdir"`
	Input       string   `json:"input"`
	Policy      string   `json:"policy"`       // "default" | "read-only" | "no-network" (no-network Linux-only Phase 4)
	TimeoutMs   int      `json:"timeout_ms"`
	MemoryMB    int      `json:"memory_mb"`
}

// SubagentExecResult
type SubagentExecResult struct {
	ExitCode   int    `json:"exit_code"`
	Stdout     string `json:"stdout"`
	Stderr     string `json:"stderr"`
	DurationMs int64  `json:"duration_ms"`
	Policy     string `json:"policy_applied"`
	Isolated   bool   `json:"isolated"`
}

// SubagentExecSafe applies a safety policy and then delegates to sandbox.exec
func SubagentExecSafe(raw json.RawMessage) (interface{}, error) {
	var p SubagentExecParams
	if err := json.Unmarshal(rawOrEmptyHelper(raw), &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}
	if p.Command == "" {
		return nil, fmt.Errorf("command is required")
	}
	// Apply policy defaults
	lim := DefaultSubagentLimiter(p.Policy)
	// Build the inner sandbox.exec params
	inner := ExecParams{
		Command:    p.Command,
		Args:       p.Args,
		Workdir:    p.Workdir,
		Input:      p.Input,
		TimeoutMs:  lim.TimeoutMs,
		MemoryMB:   lim.MemoryMB,
		CPUPercent: lim.CPUPercent,
	}
	innerJSON, _ := json.Marshal(inner)
	res, err := Exec(innerJSON)
	if err != nil {
		return nil, err
	}
	execRes, ok := res.(ExecResult)
	if !ok {
		return nil, fmt.Errorf("unexpected exec result type")
	}
	return SubagentExecResult{
		ExitCode:   execRes.ExitCode,
		Stdout:     execRes.Stdout,
		Stderr:     execRes.Stderr,
		DurationMs: execRes.DurationMs,
		Policy:     p.Policy,
		Isolated:   execRes.Isolated,
	}, nil
}

// SubagentLimiter is the per-policy resource profile.
type SubagentLimiter struct {
	TimeoutMs  int
	MemoryMB   int
	CPUPercent int
}

// DefaultSubagentLimiter maps a policy name to a resource profile.
func DefaultSubagentLimiter(policy string) SubagentLimiter {
	switch policy {
	case "read-only":
		// Cap memory tighter, no need for high CPU
		return SubagentLimiter{TimeoutMs: 15_000, MemoryMB: 128, CPUPercent: 25}
	case "no-network":
		// Phase 4: drop network namespace; for now just tighter limits
		return SubagentLimiter{TimeoutMs: 30_000, MemoryMB: 256, CPUPercent: 50}
	case "default", "":
		return SubagentLimiter{TimeoutMs: 30_000, MemoryMB: 256, CPUPercent: 50}
	default:
		return SubagentLimiter{TimeoutMs: 30_000, MemoryMB: 256, CPUPercent: 50}
	}
}

// ============================================================================
// 5. file-ops sub-agent — subagent.file_op
// ============================================================================

// SubagentFileOpParams
type SubagentFileOpParams struct {
	Op      string `json:"op"`       // "read" | "write" | "move" | "copy" | "delete" | "list" | "search"
	Src     string `json:"src"`      // source path
	Dst     string `json:"dst"`      // dest path (for move/copy)
	Content string `json:"content"`  // for write
	Pattern string `json:"pattern"`  // for search (substring or glob)
	MaxSize int    `json:"max_size"` // bytes, for read (default 16MB)
}

// SubagentFileOpResult
type SubagentFileOpResult struct {
	Op        string   `json:"op"`
	Path      string   `json:"path,omitempty"`
	Content   string   `json:"content,omitempty"`
	Size      int64    `json:"size,omitempty"`
	Files     []string `json:"files,omitempty"`
	Matches   []string `json:"matches,omitempty"`
	BytesIO   int64    `json:"bytes_io,omitempty"`
	DurationMs int64   `json:"duration_ms"`
	Error     string   `json:"error,omitempty"`
}

func SubagentFileOp(raw json.RawMessage) (interface{}, error) {
	var p SubagentFileOpParams
	if err := json.Unmarshal(rawOrEmptyHelper(raw), &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}
	if p.Op == "" {
		return nil, fmt.Errorf("op is required (read|write|move|copy|delete|list|search)")
	}
	start := time.Now()
	res := SubagentFileOpResult{Op: p.Op}
	switch p.Op {
	case "read":
		if p.Src == "" {
			return nil, fmt.Errorf("src is required for read")
		}
		data, err := os.ReadFile(p.Src)
		if err != nil {
			res.Error = err.Error()
			break
		}
		res.Path = p.Src
		res.Size = int64(len(data))
		if p.MaxSize > 0 && int64(len(data)) > int64(p.MaxSize) {
			res.Content = string(data[:p.MaxSize]) + "...(truncated)"
		} else {
			res.Content = string(data)
		}
	case "write":
		if p.Src == "" {
			return nil, fmt.Errorf("src is required for write")
		}
		if err := os.MkdirAll(filepath.Dir(p.Src), 0o755); err != nil {
			res.Error = err.Error()
			break
		}
		if err := os.WriteFile(p.Src, []byte(p.Content), 0o644); err != nil {
			res.Error = err.Error()
			break
		}
		n := len(p.Content)
		res.Path = p.Src
		res.BytesIO = int64(n)
	case "move":
		if p.Src == "" || p.Dst == "" {
			return nil, fmt.Errorf("src and dst are required for move")
		}
		if err := os.Rename(p.Src, p.Dst); err != nil {
			res.Error = err.Error()
			break
		}
		res.Path = p.Dst
	case "copy":
		if p.Src == "" || p.Dst == "" {
			return nil, fmt.Errorf("src and dst are required for copy")
		}
		data, err := os.ReadFile(p.Src)
		if err != nil {
			res.Error = err.Error()
			break
		}
		if err := os.MkdirAll(filepath.Dir(p.Dst), 0o755); err != nil {
			res.Error = err.Error()
			break
		}
		if err := os.WriteFile(p.Dst, data, 0o644); err != nil {
			res.Error = err.Error()
			break
		}
		res.Path = p.Dst
		res.BytesIO = int64(len(data))
	case "delete":
		if p.Src == "" {
			return nil, fmt.Errorf("src is required for delete")
		}
		if err := os.Remove(p.Src); err != nil {
			res.Error = err.Error()
			break
		}
		res.Path = p.Src
	case "list":
		if p.Src == "" {
			return nil, fmt.Errorf("src is required for list")
		}
		entries, err := os.ReadDir(p.Src)
		if err != nil {
			res.Error = err.Error()
			break
		}
		for _, e := range entries {
			res.Files = append(res.Files, filepath.Join(p.Src, e.Name()))
		}
		res.Path = p.Src
	case "search":
		if p.Src == "" {
			return nil, fmt.Errorf("src is required for search")
		}
		if p.Pattern == "" {
			return nil, fmt.Errorf("pattern is required for search")
		}
		// Use grep for simplicity
		cmd := exec.Command("grep", "-rl", p.Pattern, p.Src)
		out, err := cmd.Output()
		if err != nil {
			// grep exit 1 = no matches; treat as empty
			if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
				res.Path = p.Src
				break
			}
			res.Error = err.Error()
			break
		}
		for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			if line != "" {
				res.Matches = append(res.Matches, line)
			}
		}
		res.Path = p.Src
	default:
		return nil, fmt.Errorf("unknown op: %s", p.Op)
	}
	res.DurationMs = time.Since(start).Milliseconds()
	return res, nil
}

// rawOrEmptyHelper is a small helper to safely treat an empty
// json.RawMessage as the empty object.
func rawOrEmptyHelper(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage("{}")
	}
	return raw
}

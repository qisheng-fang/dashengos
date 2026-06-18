// agent.go — agent.list + agent.run
//
// v0.3 spec §15.5 — agent registry + run
// Phase 3 简化为注册表 + 排队模式, Phase 4 接真 backend
package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

type AgentInfo struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Author       string   `json:"author"`
	Description  string   `json:"description"`
	Capabilities []string `json:"capabilities"`
	Installed    bool     `json:"installed"`
}

type AgentJob struct {
	ID         string                 `json:"id"`
	AgentID    string                 `json:"agent_id"`
	Input      map[string]any         `json:"input"`
	Status     string                 `json:"status"`
	Progress   int                    `json:"progress"`
	Result     map[string]any         `json:"result,omitempty"`
	CreatedAt  int64                  `json:"created_at"`
	UpdatedAt  int64                  `json:"updated_at"`
	Error      string                 `json:"error,omitempty"`
	streamCh   chan map[string]any     `json:"-"`
}

// AgentStore
type AgentStore struct {
	registry []AgentInfo
	jobs     *safeMap[string, *AgentJob]
	cancels  map[string]context.CancelFunc
	mu       sync.Mutex
}

func NewAgentStore() *AgentStore {
	// v0.3 spec §15.5 — 默认 6 个 agent (跟 apps/web/src/screens/AgentMarket.tsx 对齐)
	registry := []AgentInfo{
		{ID: "code-reviewer", Name: "Code Reviewer", Author: "@bytedance",
			Description: "审查 PR, 检测 SQL 注入/XSS 等安全问题",
			Capabilities: []string{"code-review", "security-scan", "test-gen"}, Installed: true},
		{ID: "deep-researcher", Name: "Deep Researcher", Author: "@anthropic",
			Description: "多步网络研究 + 综合报告",
			Capabilities: []string{"web-search", "summarize", "citation"}, Installed: true},
		{ID: "design-assistant", Name: "Design Assistant", Author: "@anthropic",
			Description: "UI 创意 + 视觉设计建议",
			Capabilities: []string{"design", "color-theory", "layout"}, Installed: true},
		{ID: "data-analyst", Name: "Data Analyst", Author: "@workbuddy",
			Description: "SQL 查询 + 数据可视化 + 报表",
			Capabilities: []string{"sql", "viz", "report"}, Installed: true},
		{ID: "security-reviewer", Name: "Security Reviewer", Author: "@community",
			Description: "OWASP Top 10 + 漏洞扫描",
			Capabilities: []string{"security", "pentest", "owasp"}, Installed: true},
		{ID: "custom-workflow", Name: "Custom Workflow", Author: "@user",
			Description: "用户自定义工作流 (deerflow-style)",
			Capabilities: []string{"custom", "low-code"}, Installed: true},
	}
	return &AgentStore{
		registry: registry,
		jobs:     newSafeMap[string, *AgentJob](),
		cancels:  make(map[string]context.CancelFunc),
	}
}

// --- agent.list ---

type AgentListResult struct {
	Agents []AgentInfo `json:"agents"`
}

func AgentList(store *AgentStore) func(json.RawMessage) (interface{}, error) {
	return func(_ json.RawMessage) (interface{}, error) {
		return AgentListResult{Agents: store.registry}, nil
	}
}

// --- agent.run ---

type AgentRunParams struct {
	AgentID string         `json:"agent_id"`
	Input   map[string]any `json:"input"`
}

type AgentRunResult struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

func AgentRun(store *AgentStore) func(json.RawMessage) (interface{}, error) {
	return func(raw json.RawMessage) (interface{}, error) {
		p, err := jsonParams[AgentRunParams](raw)
		if err != nil {
			return nil, err
		}
		if p.AgentID == "" {
			return nil, fmt.Errorf("agent_id is required")
		}
		// Verify agent exists
		found := false
		for _, a := range store.registry {
			if a.ID == p.AgentID {
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("agent not found: %s", p.AgentID)
		}
		id := newID()
		now := time.Now().UnixMilli()
		job := &AgentJob{
			ID:        id,
			AgentID:   p.AgentID,
			Input:     p.Input,
			Status:    "queued",
			CreatedAt: now,
			UpdatedAt: now,
			streamCh:  make(chan map[string]any, 16),
		}
		store.jobs.Set(id, job)
		go simulateAgent(store, job)
		return AgentRunResult{ID: id, Status: "queued"}, nil
	}
}

func simulateAgent(store *AgentStore, job *AgentJob) {
	ctx, cancel := context.WithCancel(context.Background())
	store.mu.Lock()
	store.cancels[job.ID] = cancel
	store.mu.Unlock()
	defer func() {
		store.mu.Lock()
		delete(store.cancels, job.ID)
		store.mu.Unlock()
		close(job.streamCh)
	}()

	job.Status = "running"
	job.Progress = 10
	job.UpdatedAt = time.Now().UnixMilli()
	select {
	case <-ctx.Done():
		return
	case <-time.After(500 * time.Millisecond):
	}
	job.Progress = 50
	job.UpdatedAt = time.Now().UnixMilli()
	select {
	case <-ctx.Done():
		return
	case <-time.After(800 * time.Millisecond):
	}
	job.Progress = 100
	job.Status = "done"
	job.Result = map[string]any{
		"output": fmt.Sprintf("Mock output from agent %s", job.AgentID),
		"tokens": 1234,
	}
	job.UpdatedAt = time.Now().UnixMilli()
}

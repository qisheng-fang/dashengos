// research.go — research.run / status / result / cancel / stream
//
// v0.3 spec §15.2 — research 工作流
// Phase 3 简化版: 内存里维护 job, 模拟阶段转换 queued → running → done
// Phase 4 接真 LLM 调用 (call DeShengOS backend)
package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

type ResearchJobState string

const (
	ResearchQueued   ResearchJobState = "queued"
	ResearchRunning  ResearchJobState = "running"
	ResearchDone     ResearchJobState = "done"
	ResearchError    ResearchJobState = "error"
	ResearchCancelled ResearchJobState = "cancelled"
)

type ResearchFinding struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Snippet string `json:"snippet"`
}

type ResearchJob struct {
	ID         string             `json:"id"`
	Query      string             `json:"query"`
	MaxResults int                `json:"max_results"`
	Status     ResearchJobState     `json:"status"`
	Progress   int                `json:"progress"` // 0-100
	CreatedAt  int64              `json:"created_at"`
	UpdatedAt  int64              `json:"updated_at"`
	Findings   []ResearchFinding  `json:"findings"`
	Error      string             `json:"error,omitempty"`
	streamCh   chan map[string]any `json:"-"`
}

// ResearchStore — in-memory job store + background simulator
type ResearchStore struct {
	mu      sync.Mutex
	jobs    *safeMap[string, *ResearchJob]
	once    sync.Once
	stopCh  chan struct{}
	// cancel hooks (so cancel can interrupt a running simulation)
	cancels map[string]context.CancelFunc
}

func NewResearchStore() *ResearchStore {
	return &ResearchStore{
		jobs:    newSafeMap[string, *ResearchJob](),
		stopCh:  make(chan struct{}),
		cancels: make(map[string]context.CancelFunc),
	}
}

// --- research.run ---

type ResearchRunParams struct {
	Query      string `json:"query"`
	MaxResults int    `json:"max_results"`
}

type ResearchRunResult struct {
	ID     string         `json:"id"`
	Status ResearchJobState `json:"status"`
}

func ResearchRun(store *ResearchStore) func(json.RawMessage) (interface{}, error) {
	return func(raw json.RawMessage) (interface{}, error) {
		p, err := jsonParams[ResearchRunParams](raw)
		if err != nil {
			return nil, err
		}
		if p.Query == "" {
			return nil, fmt.Errorf("query is required")
		}
		if p.MaxResults == 0 {
			p.MaxResults = 5
		}
		id := newID()
		now := time.Now().UnixMilli()
		job := &ResearchJob{
			ID:         id,
			Query:      p.Query,
			MaxResults: p.MaxResults,
			Status:     ResearchQueued,
			Progress:   0,
			CreatedAt:  now,
			UpdatedAt:  now,
			streamCh:   make(chan map[string]any, 16),
		}
		store.jobs.Set(id, job)
		// Simulate background processing (Phase 4: dispatch to LLM agent)
		go simulateResearch(store, job)
		return ResearchRunResult{ID: id, Status: ResearchQueued}, nil
	}
}

// --- research.status ---

type ResearchStatusParams struct {
	ID string `json:"id"`
}

type ResearchStatusResult struct {
	ID       string         `json:"id"`
	Status   ResearchJobState `json:"status"`
	Progress int            `json:"progress"`
	Error    string         `json:"error,omitempty"`
}

func ResearchStatus(store *ResearchStore) func(json.RawMessage) (interface{}, error) {
	return func(raw json.RawMessage) (interface{}, error) {
		p, err := jsonParams[ResearchStatusParams](raw)
		if err != nil {
			return nil, err
		}
		job, ok := store.jobs.Get(p.ID)
		if !ok {
			return nil, fmt.Errorf("research job not found: %s", p.ID)
		}
		return ResearchStatusResult{
			ID:       job.ID,
			Status:   job.Status,
			Progress: job.Progress,
			Error:    job.Error,
		}, nil
	}
}

// --- research.result ---

type ResearchResultParams struct {
	ID string `json:"id"`
}

type ResearchResultOutput struct {
	ID       string            `json:"id"`
	Query    string            `json:"query"`
	Status   ResearchJobState    `json:"status"`
	Findings []ResearchFinding `json:"findings"`
	Error    string            `json:"error,omitempty"`
}

func ResearchResult(store *ResearchStore) func(json.RawMessage) (interface{}, error) {
	return func(raw json.RawMessage) (interface{}, error) {
		p, err := jsonParams[ResearchResultParams](raw)
		if err != nil {
			return nil, err
		}
		job, ok := store.jobs.Get(p.ID)
		if !ok {
			return nil, fmt.Errorf("research job not found: %s", p.ID)
		}
		if job.Status != ResearchDone && job.Status != ResearchError && job.Status != ResearchCancelled {
			return nil, fmt.Errorf("research job not finished: status=%s progress=%d", job.Status, job.Progress)
		}
		return ResearchResultOutput{
			ID:       job.ID,
			Query:    job.Query,
			Status:   job.Status,
			Findings: job.Findings,
			Error:    job.Error,
		}, nil
	}
}

// --- research.cancel ---

type ResearchCancelParams struct {
	ID string `json:"id"`
}

type ResearchCancelResult struct {
	ID        string `json:"id"`
	Cancelled bool   `json:"cancelled"`
}

func ResearchCancel(store *ResearchStore) func(json.RawMessage) (interface{}, error) {
	return func(raw json.RawMessage) (interface{}, error) {
		p, err := jsonParams[ResearchCancelParams](raw)
		if err != nil {
			return nil, err
		}
		job, ok := store.jobs.Get(p.ID)
		if !ok {
			return nil, fmt.Errorf("research job not found: %s", p.ID)
		}
		store.mu.Lock()
		cancel, hasCancel := store.cancels[p.ID]
		if hasCancel {
			cancel()
			delete(store.cancels, p.ID)
		}
		store.mu.Unlock()
		job.Status = ResearchCancelled
		job.UpdatedAt = time.Now().UnixMilli()
		return ResearchCancelResult{ID: p.ID, Cancelled: hasCancel || job.Status == ResearchDone}, nil
	}
}

// --- research.stream (returns the buffered events so far) ---
//
// Phase 3: stream is request/response only. Events emitted during the
// background simulation are stored on the job and returned on demand.
// Phase 4 will upgrade to SSE/Chunked transfer encoding for live streaming.

type ResearchStreamParams struct {
	ID    string `json:"id"`
	Since int    `json:"since"` // cursor; 0 = from start
}

type ResearchStreamEvent struct {
	Cursor int            `json:"cursor"`
	Type   string         `json:"type"`
	Status ResearchJobState `json:"status,omitempty"`
	Text   string         `json:"text,omitempty"`
}

func ResearchStream(store *ResearchStore) func(json.RawMessage) (interface{}, error) {
	return func(raw json.RawMessage) (interface{}, error) {
		p, err := jsonParams[ResearchStreamParams](raw)
		if err != nil {
			return nil, err
		}
		job, ok := store.jobs.Get(p.ID)
		if !ok {
			return nil, fmt.Errorf("research job not found: %s", p.ID)
		}
		// Drain the channel non-blockingly
		var events []ResearchStreamEvent
		for {
			select {
			case ev, ok := <-job.streamCh:
				if !ok {
					return map[string]any{"id": p.ID, "events": events, "status": job.Status}, nil
				}
				// Convert
				cur, _ := ev["cursor"].(int)
				if cur <= p.Since {
					continue
				}
				events = append(events, ResearchStreamEvent{
					Cursor: cur,
					Type:   asString(ev["type"]),
					Status: ResearchJobState(asString(ev["status"])),
					Text:   asString(ev["text"]),
				})
			default:
				return map[string]any{"id": p.ID, "events": events, "status": job.Status}, nil
			}
		}
	}
}

// --- background simulator ---

func simulateResearch(store *ResearchStore, job *ResearchJob) {
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

	steps := []struct {
		from ResearchJobState
		to   ResearchJobState
		text string
		ms   int
	}{
		{ResearchQueued, ResearchRunning, "正在检索", 800},
		{ResearchRunning, ResearchRunning, "分析来源", 1500},
		{ResearchRunning, ResearchRunning, "综合结论", 1000},
		{ResearchRunning, ResearchDone, "完成", 500},
	}
	cursor := 0
	emit := func(typ, text string, status ResearchJobState) {
		cursor++
		job.streamCh <- map[string]any{
			"cursor": cursor,
			"type":   typ,
			"text":   text,
			"status": status,
		}
	}
	for i, s := range steps {
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Duration(s.ms) * time.Millisecond):
		}
		job.Status = s.to
		job.Progress = (i + 1) * 100 / len(steps)
		job.UpdatedAt = time.Now().UnixMilli()
		emit("status", s.text, s.to)
	}
	// Generate mock findings
	job.Findings = []ResearchFinding{
		{Title: "Finding 1 for: " + job.Query, URL: "https://example.com/1", Snippet: "Sample snippet"},
		{Title: "Finding 2 for: " + job.Query, URL: "https://example.com/2", Snippet: "Sample snippet"},
	}
}

func asString(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

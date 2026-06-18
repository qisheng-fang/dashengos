// Package handlers — subagent_test.go
//
// Go unit tests for sub-agent handlers. Complements the Python/TS
// integration tests in test_e2e.py and test-sandbox-socket.ts.
package handlers

import (
	"encoding/json"
	"testing"
)

func TestSubagentResearchBasic(t *testing.T) {
	raw := []byte(`{"query":"quantum computing","depth":3,"cite_sources":true}`)
	res, err := SubagentResearch(raw)
	if err != nil {
		t.Fatalf("research: %v", err)
	}
	r := res.(SubagentResearchResult)
	if r.Query != "quantum computing" {
		t.Errorf("query = %q, want %q", r.Query, "quantum computing")
	}
	if len(r.SubQueries) != 3 {
		t.Errorf("sub_queries = %d, want 3", len(r.SubQueries))
	}
	if len(r.Findings) != 3 {
		t.Errorf("findings = %d, want 3", len(r.Findings))
	}
	if len(r.Citations) != 3 {
		t.Errorf("citations = %d, want 3", len(r.Citations))
	}
}

func TestSubagentResearchRejectsEmptyQuery(t *testing.T) {
	raw := []byte(`{}`)
	_, err := SubagentResearch(raw)
	if err == nil {
		t.Error("expected error for empty query, got nil")
	}
}

func TestSubagentRunAgentWaitResult(t *testing.T) {
	raw := []byte(`{"agent_id":"code-reviewer","wait_result":true,"chain_with":["deep-researcher","data-analyst"]}`)
	res, err := SubagentRunAgent(raw)
	if err != nil {
		t.Fatalf("run_agent: %v", err)
	}
	r := res.(SubagentRunAgentResult)
	if r.Status != "done" {
		t.Errorf("status = %q, want done", r.Status)
	}
	if len(r.ChainedIDs) != 2 {
		t.Errorf("chained_ids = %d, want 2", len(r.ChainedIDs))
	}
}

func TestSubagentRunAgentMissingAgentID(t *testing.T) {
	raw := []byte(`{}`)
	_, err := SubagentRunAgent(raw)
	if err == nil {
		t.Error("expected error for missing agent_id")
	}
}

func TestSubagentApplySkillRejectsTraversal(t *testing.T) {
	bad := []struct {
		name string
		id   string
	}{
		{"slash", "../etc/passwd"},
		{"dotdot", ".."},
		{"dot", ".hidden"},
	}
	for _, b := range bad {
		t.Run(b.name, func(t *testing.T) {
			raw, _ := json.Marshal(SubagentApplySkillParams{SkillID: b.id})
			_, err := SubagentApplySkill(raw)
			if err == nil {
				t.Errorf("expected error for %q", b.id)
			}
		})
	}
}

func TestSubagentExecSafeAppliesPolicy(t *testing.T) {
	cases := []struct {
		policy string
		wantMB int
	}{
		{"default", 256},
		{"read-only", 128},
		{"no-network", 256},
		{"", 256},
	}
	for _, c := range cases {
		t.Run(c.policy, func(t *testing.T) {
			lim := DefaultSubagentLimiter(c.policy)
			if lim.MemoryMB != c.wantMB {
				t.Errorf("policy %s: MemoryMB = %d, want %d", c.policy, lim.MemoryMB, c.wantMB)
			}
		})
	}
}

func TestSubagentFileOpList(t *testing.T) {
	dir := t.TempDir()
	raw, _ := json.Marshal(SubagentFileOpParams{Op: "list", Src: dir})
	res, err := SubagentFileOp(raw)
	if err != nil {
		t.Fatalf("file_op list: %v", err)
	}
	r := res.(SubagentFileOpResult)
	if r.Path != dir {
		t.Errorf("path = %q, want %q", r.Path, dir)
	}
}

func TestSubagentFileOpWriteRead(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/hello.txt"
	// write
	wraw, _ := json.Marshal(SubagentFileOpParams{Op: "write", Src: path, Content: "hi"})
	wres, err := SubagentFileOp(wraw)
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	wr := wres.(SubagentFileOpResult)
	if wr.BytesIO != 2 {
		t.Errorf("bytes_io = %d, want 2", wr.BytesIO)
	}
	// read
	rraw, _ := json.Marshal(SubagentFileOpParams{Op: "read", Src: path})
	rres, err := SubagentFileOp(rraw)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	rr := rres.(SubagentFileOpResult)
	if rr.Content != "hi" {
		t.Errorf("content = %q, want hi", rr.Content)
	}
}

func TestSubagentFileOpRejectsBadOp(t *testing.T) {
	raw := []byte(`{"op":"hack"}`)
	_, err := SubagentFileOp(raw)
	if err == nil {
		t.Error("expected error for unknown op")
	}
}

func TestSubagentFileOpRejectsMissingArgs(t *testing.T) {
	cases := []struct {
		name string
		p    SubagentFileOpParams
	}{
		{"read_no_src", SubagentFileOpParams{Op: "read"}},
		{"write_no_src", SubagentFileOpParams{Op: "write"}},
		{"move_no_dst", SubagentFileOpParams{Op: "move", Src: "/tmp"}},
		{"delete_no_src", SubagentFileOpParams{Op: "delete"}},
		{"list_no_src", SubagentFileOpParams{Op: "list"}},
		{"search_no_pattern", SubagentFileOpParams{Op: "search", Src: "/tmp"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			raw, _ := json.Marshal(c.p)
			_, err := SubagentFileOp(raw)
			if err == nil {
				t.Errorf("expected error for %s", c.name)
			}
		})
	}
}

func TestSafeMap(t *testing.T) {
	m := newSafeMap[string, int]()
	m.Set("a", 1)
	m.Set("b", 2)
	if v, ok := m.Get("a"); !ok || v != 1 {
		t.Errorf("Get a = %d, %v; want 1, true", v, ok)
	}
	if m.Len() != 2 {
		t.Errorf("Len = %d, want 2", m.Len())
	}
	m.Delete("a")
	if _, ok := m.Get("a"); ok {
		t.Error("a should be deleted")
	}
}

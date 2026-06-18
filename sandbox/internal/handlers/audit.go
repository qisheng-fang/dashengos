// audit.go — audit.write
//
// v0.3 spec §15.7 — 审计日志, HMAC 签名
// Phase 3: 写到 ~/.dasheng/audit.log (NDJSON)
package handlers

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type AuditEvent struct {
	ID        string         `json:"id"`
	Timestamp int64          `json:"timestamp"`
	Action    string         `json:"action"`
	Actor     string         `json:"actor"`
	Target    string         `json:"target,omitempty"`
	Metadata  map[string]any `json:"metadata,omitempty"`
	HMAC      string         `json:"hmac"` // HMAC-SHA256 over all fields except hmac
}

type AuditStore struct {
	mu   sync.Mutex
	path string
	key  []byte
}

func NewAuditStore() *AuditStore {
	home := os.Getenv("HOME")
	dir := filepath.Join(home, ".dasheng")
	_ = os.MkdirAll(dir, 0o755)
	key := os.Getenv("DASHE_AUDIT_KEY")
	if key == "" {
		key = "dev-key-CHANGE-IN-PROD" // spec allows this for dev
	}
	return &AuditStore{
		path: filepath.Join(dir, "audit.log"),
		key:  []byte(key),
	}
}

type AuditWriteParams struct {
	Action   string         `json:"action"`
	Actor    string         `json:"actor"`
	Target   string         `json:"target"`
	Metadata map[string]any `json:"metadata"`
}

type AuditWriteResult struct {
	ID        string `json:"id"`
	Timestamp int64  `json:"timestamp"`
	HMAC      string `json:"hmac"`
}

func AuditWrite(store *AuditStore) func(json.RawMessage) (interface{}, error) {
	return func(raw json.RawMessage) (interface{}, error) {
		p, err := jsonParams[AuditWriteParams](raw)
		if err != nil {
			return nil, err
		}
		if p.Action == "" {
			return nil, fmt.Errorf("action is required")
		}
		if p.Actor == "" {
			p.Actor = "anonymous"
		}
		ev := AuditEvent{
			ID:        newID(),
			Timestamp: time.Now().UnixMilli(),
			Action:    p.Action,
			Actor:     p.Actor,
			Target:    p.Target,
			Metadata:  p.Metadata,
		}
		// HMAC over canonical form
		mac := hmac.New(sha256.New, store.key)
		canon, _ := json.Marshal(map[string]any{
			"id":        ev.ID,
			"timestamp": ev.Timestamp,
			"action":    ev.Action,
			"actor":     ev.Actor,
			"target":    ev.Target,
			"metadata":  ev.Metadata,
		})
		mac.Write(canon)
		ev.HMAC = hex.EncodeToString(mac.Sum(nil))

		// Append to log (NDJSON)
		store.mu.Lock()
		defer store.mu.Unlock()
		f, err := os.OpenFile(store.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
		if err != nil {
			return nil, fmt.Errorf("open audit log: %w", err)
		}
		defer f.Close()
		line, _ := json.Marshal(ev)
		if _, err := f.Write(append(line, '\n')); err != nil {
			return nil, fmt.Errorf("write audit: %w", err)
		}
		return AuditWriteResult{
			ID:        ev.ID,
			Timestamp: ev.Timestamp,
			HMAC:      ev.HMAC,
		}, nil
	}
}

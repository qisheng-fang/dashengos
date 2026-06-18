// Package handlers implements the 16 IPC methods exposed by the
// DaShengOS sandbox daemon (v0.3 spec §15-17). All handlers are
// pure Go + stdlib; storage is in-memory + filesystem (no DB).
//
// Each handler returns (result, error). The error is serialized as
// a JSON-RPC error response by the ipc.Server.
package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
)

// ulid-like random ID (8 bytes hex = 16 chars). Sufficient for
// in-memory correlation within a single daemon run.
func newID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// jsonParams is a small helper for unmarshalling raw JSON params
// into a typed struct.
func jsonParams[T any](raw json.RawMessage) (T, error) {
	var v T
	if len(raw) == 0 {
		return v, nil
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return v, fmt.Errorf("invalid params: %w", err)
	}
	return v, nil
}

// safeMap wraps a map with sync.RWMutex for in-memory state.
type safeMap[K comparable, V any] struct {
	mu sync.RWMutex
	m  map[K]V
}

func newSafeMap[K comparable, V any]() *safeMap[K, V] {
	return &safeMap[K, V]{m: make(map[K]V)}
}

func (s *safeMap[K, V]) Get(k K) (V, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	v, ok := s.m[k]
	return v, ok
}

func (s *safeMap[K, V]) Set(k K, v V) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[k] = v
}

func (s *safeMap[K, V]) Delete(k K) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.m, k)
}

func (s *safeMap[K, V]) Len() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.m)
}

func (s *safeMap[K, V]) Values() []V {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]V, 0, len(s.m))
	for _, v := range s.m {
		out = append(out, v)
	}
	return out
}

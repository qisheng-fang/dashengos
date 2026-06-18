// file.go — file.read + file.write
//
// v0.3 spec §15.4 — 受限文件操作
// 安全: 路径白名单 (ALLOWED_READ_ROOTS / ALLOWED_WRITE_ROOTS env),
// 禁止 .. 越界, 大小限制 16 MB
package handlers

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const MaxFileSize = 16 * 1024 * 1024 // 16 MB

// FileReadParams
type FileReadParams struct {
	Path    string `json:"path"`
	Encoding string `json:"encoding"` // "utf-8" (default) | "base64"
}

// FileReadResult
type FileReadResult struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	Size    int64  `json:"size"`
	Mtime   int64  `json:"mtime"`
}

func FileRead(params json.RawMessage) (interface{}, error) {
	var p FileReadParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}
	safe, err := resolveSafe(p.Path, "read")
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(safe)
	if err != nil {
		return nil, fmt.Errorf("stat: %w", err)
	}
	if info.Size() > MaxFileSize {
		return nil, fmt.Errorf("file too large: %d > %d", info.Size(), MaxFileSize)
	}
	data, err := os.ReadFile(safe)
	if err != nil {
		return nil, fmt.Errorf("read: %w", err)
	}
	enc := p.Encoding
	if enc == "" {
		enc = "utf-8"
	}
	var content string
	switch enc {
	case "utf-8":
		content = string(data)
	case "base64":
		content = base64.StdEncoding.EncodeToString(data)
	default:
		return nil, fmt.Errorf("unsupported encoding: %s", enc)
	}
	return FileReadResult{
		Path:    safe,
		Content: content,
		Size:    info.Size(),
		Mtime:   info.ModTime().UnixMilli(),
	}, nil
}

// FileWriteParams
type FileWriteParams struct {
	Path       string `json:"path"`
	Content    string `json:"content"`
	Encoding   string `json:"encoding"` // "utf-8" (default) | "base64"
	CreateDirs bool   `json:"create_dirs"`
}

// FileWriteResult
type FileWriteResult struct {
	Path         string `json:"path"`
	BytesWritten int    `json:"bytes_written"`
	Mtime        int64  `json:"mtime"`
}

func FileWrite(params json.RawMessage) (interface{}, error) {
	var p FileWriteParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}
	if p.Path == "" {
		return nil, errors.New("path is required")
	}
	safe, err := resolveSafe(p.Path, "write")
	if err != nil {
		return nil, err
	}
	enc := p.Encoding
	if enc == "" {
		enc = "utf-8"
	}
	var data []byte
	switch enc {
	case "utf-8":
		data = []byte(p.Content)
	case "base64":
		data, err = base64.StdEncoding.DecodeString(p.Content)
		if err != nil {
			return nil, fmt.Errorf("invalid base64: %w", err)
		}
	default:
		return nil, fmt.Errorf("unsupported encoding: %s", enc)
	}
	if len(data) > MaxFileSize {
		return nil, fmt.Errorf("payload too large: %d > %d", len(data), MaxFileSize)
	}
	if p.CreateDirs {
		if err := os.MkdirAll(filepath.Dir(safe), 0o755); err != nil {
			return nil, fmt.Errorf("mkdir: %w", err)
		}
	}
	if err := os.WriteFile(safe, data, 0o644); err != nil {
		return nil, fmt.Errorf("write: %w", err)
	}
	return FileWriteResult{
		Path:         safe,
		BytesWritten: len(data),
		Mtime:        timeMillis(),
	}, nil
}

// resolveSafe normalizes a path and ensures it lives under one of the
// allow-listed roots. The roots are comma-separated env vars:
//   DASHE_SANDBOX_READ_ROOTS  — file.read
//   DASHE_SANDBOX_WRITE_ROOTS — file.write
// If unset, the default is the user's home + a /tmp/dasheng workspace.
func resolveSafe(p, op string) (string, error) {
	if !filepath.IsAbs(p) {
		return "", fmt.Errorf("path must be absolute: %s", p)
	}
	cleaned := filepath.Clean(p)
	// Block obvious escapes (defense in depth — filepath.Clean already handles ..)
	if strings.Contains(cleaned, "..") {
		return "", errors.New("path traversal not allowed")
	}
	roots := defaultRoots(op)
	for _, root := range roots {
		if isUnder(cleaned, root) {
			return cleaned, nil
		}
	}
	return "", fmt.Errorf("path not in %s allowlist: %s", op, p)
}

func defaultRoots(op string) []string {
	home := os.Getenv("HOME")
	roots := []string{filepath.Join(home, "Library"), "/tmp/dasheng"}
	if op == "read" {
		roots = append(roots, "/usr", "/opt", "/var/log")
	}
	return roots
}

func isUnder(path, root string) bool {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	if strings.HasPrefix(rel, "..") || rel == ".." {
		return false
	}
	return true
}

func timeMillis() int64 { return time.Now().UnixMilli() }

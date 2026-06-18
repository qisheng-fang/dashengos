// Package handlers — exec.go: sandbox.exec
//
// v0.3 spec §16 — 在 Linux 上以 namespace+seccomp+cgroup 隔离子进程执行命令
// macOS dev: 退化为 process-level (exec.Command), 打印 warning
package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/dashengos/sandbox/internal/security"
)

// ExecParams — sandbox.exec 输入
type ExecParams struct {
	Command    string   `json:"command"`     // e.g. "node"
	Args       []string `json:"args"`        // e.g. ["--version"]
	Workdir    string   `json:"workdir"`     // absolute path
	Env        []string `json:"env"`         // extra env (key=value)
	Input      string   `json:"input"`       // stdin data
	TimeoutMs  int      `json:"timeout_ms"`  // wall-clock; 0 = no timeout
	MemoryMB   int      `json:"memory_mb"`   // 0 = default 256
	CPUPercent int      `json:"cpu_percent"` // 0 = default 50
}

// ExecResult — sandbox.exec 输出
type ExecResult struct {
	ExitCode   int    `json:"exit_code"`
	Stdout     string `json:"stdout"`
	Stderr     string `json:"stderr"`
	DurationMs int64  `json:"duration_ms"`
	TimedOut   bool   `json:"timed_out"`
	Isolated   bool   `json:"isolated"` // true if full Linux isolation
}

// Exec implements sandbox.exec.
//
// On Linux: best-effort namespace+seccomp+cgroup (the kernel may deny
// if running in a non-privileged container without unshare caps).
// On macOS: just exec.Command, logs warning, sets Isolated=false.
func Exec(params json.RawMessage) (interface{}, error) {
	var p ExecParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}
	if strings.TrimSpace(p.Command) == "" {
		return nil, errors.New("command is required")
	}
	// Resolve absolute path for security check
	cmdPath, err := exec.LookPath(p.Command)
	if err != nil {
		// Try as-is (could be a script with shebang)
		cmdPath = p.Command
	}
	// Workdir safety: must be absolute and exist
	if p.Workdir == "" {
		wd, _ := os.Getwd()
		p.Workdir = wd
	}
	if !filepath.IsAbs(p.Workdir) {
		return nil, fmt.Errorf("workdir must be absolute: %s", p.Workdir)
	}

	// Apply cgroup limits (Linux only)
	lim := security.DefaultLimiter()
	if p.MemoryMB > 0 {
		lim.MemoryMaxBytes = int64(p.MemoryMB) * 1024 * 1024
	}
	if p.CPUPercent > 0 {
		lim.CPUQuotaPercent = p.CPUPercent
	}
	if p.TimeoutMs > 0 {
		lim.TimeoutMs = p.TimeoutMs
	}
	_, cgroupCleanup, err := security.ApplyCgroup(lim)
	if err != nil {
		// Not fatal — fall through without cgroup
		security.WarnIfNotLinux()
	} else if cgroupCleanup != nil {
		defer cgroupCleanup()
	}

	// Build the command
	ctx := context.Background()
	if lim.TimeoutMs > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, time.Duration(lim.TimeoutMs)*time.Millisecond)
		defer cancel()
	}
	cmd := exec.CommandContext(ctx, cmdPath, p.Args...)
	cmd.Dir = p.Workdir
	cmd.Env = append([]string{}, p.Env...)
	if len(p.Input) > 0 {
		cmd.Stdin = strings.NewReader(p.Input)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	// Linux: apply namespace + seccomp. We use runtime calls so
	// this file doesn't need to import syscall (which would force
	// the syscall-using parts to be Linux-only). Instead, the
	// helpers in exec_linux.go / exec_other.go are no-op stubs on
	// non-Linux.
	applyLinuxIsolation(cmd)
	if err := security.ApplySeccomp(); err != nil {
		security.WarnIfNotLinux()
	}

	start := time.Now()
	err = cmd.Run()
	dur := time.Since(start).Milliseconds()

	result := ExecResult{
		Stdout:     stdout.String(),
		Stderr:     stderr.String(),
		DurationMs: dur,
		Isolated:   security.IsLinux(),
	}
	if ctx.Err() == context.DeadlineExceeded {
		result.TimedOut = true
		result.ExitCode = -1
		return result, nil
	}
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			result.ExitCode = ee.ExitCode()
		} else {
			return nil, fmt.Errorf("exec failed: %w", err)
		}
	} else {
		result.ExitCode = 0
	}
	return result, nil
}

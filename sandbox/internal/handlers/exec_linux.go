//go:build linux

package handlers

import (
	"os/exec"
	"syscall"

	"github.com/dashengos/sandbox/internal/security"
)

// applyLinuxIsolation wires up the Linux-only namespace into the
// child command. No-op on non-Linux.
func applyLinuxIsolation(cmd *exec.Cmd) {
	if !security.IsLinux() {
		return
	}
	// security.ApplyNamespace() returns *syscall.SysProcAttr on Linux.
	var sysAttr *syscall.SysProcAttr
	if sattr, ok := security.ApplyNamespace().(*syscall.SysProcAttr); ok {
		sysAttr = sattr
	}
	if sysAttr != nil {
		cmd.SysProcAttr = sysAttr
	}
}

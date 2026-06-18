//go:build !linux

package handlers

import "os/exec"

// applyLinuxIsolation is a no-op on non-Linux platforms.
func applyLinuxIsolation(_ *exec.Cmd) {}

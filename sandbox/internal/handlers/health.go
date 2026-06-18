package handlers

import (
	"encoding/json"
	"runtime"
)

// HealthPingParams: empty
type HealthPingResult struct {
	Status  string `json:"status"`
	Version string `json:"version"`
	Go      string `json:"go"`
	OS      string `json:"os"`
	Arch    string `json:"arch"`
	Methods int    `json:"methods"`
}

const SandboxVersion = "v0.3.0-phase3"

// HealthPing returns daemon health + platform info. Method count is
// injected by Register to avoid a circular import.
func HealthPing(methodCount int) func(json.RawMessage) (interface{}, error) {
	return func(_ json.RawMessage) (interface{}, error) {
		return HealthPingResult{
			Status:  "ok",
			Version: SandboxVersion,
			Go:      runtime.Version(),
			OS:      runtime.GOOS,
			Arch:    runtime.GOARCH,
			Methods: methodCount,
		}, nil
	}
}

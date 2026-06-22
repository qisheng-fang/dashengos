// secret.go — secret.read
//
// v0.3 spec §15.8 — secret 读取
// Phase 3: 走 macOS Keychain (security 命令) / Linux pass / 环境变量兜底
// 生产部署应该用 Vault / KMS, Phase 4 接入
package handlers

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

type SecretReadParams struct {
	Name string `json:"name"`
}

type SecretReadResult struct {
	Name  string `json:"name"`
	Value string `json:"value"`
	Source string `json:"source"` // "keychain" | "env" | "pass" | "file"
}

func SecretRead(raw json.RawMessage) (interface{}, error) {
	p, err := jsonParams[SecretReadParams](raw)
	if err != nil {
		return nil, err
	}
	if p.Name == "" {
		return nil, fmt.Errorf("name is required")
	}
	// 1. Try env first
	if v, ok := os.LookupEnv("DASHE_SECRET_" + strings.ToUpper(strings.ReplaceAll(p.Name, "-", "_"))); ok {
		return SecretReadResult{Name: p.Name, Value: v, Source: "env"}, nil
	}
	// 2. Platform-specific
	switch runtime.GOOS {
	case "darwin":
		return secretMacOS(p.Name)
	case "linux":
		return secretLinux(p.Name)
	default:
		return nil, fmt.Errorf("secret backend not available on %s", runtime.GOOS)
	}
}

func secretMacOS(name string) (SecretReadResult, error) {
	// security find-generic-password -s "dasheng" -a "<name>" -w
	cmd := exec.Command("security", "find-generic-password", "-s", "dasheng", "-a", name, "-w")
	out, err := cmd.Output()
	if err != nil {
		// Fall back to ~/.dasheng/secrets/<name> file
		home := os.Getenv("HOME")
		path := fmt.Sprintf("%s/.dasheng/secrets/%s", home, name)
		if v, ferr := os.ReadFile(path); ferr == nil {
			return SecretReadResult{Name: name, Value: strings.TrimSpace(string(v)), Source: "file"}, nil
		}
		return SecretReadResult{}, fmt.Errorf("secret not found: %s", name)
	}
	return SecretReadResult{Name: name, Value: strings.TrimSpace(string(out)), Source: "keychain"}, nil
}

func secretLinux(name string) (SecretReadResult, error) {
	// Try pass first
	if _, err := exec.LookPath("pass"); err == nil {
		cmd := exec.Command("pass", "show", "dasheng/"+name)
		if out, err := cmd.Output(); err == nil {
			return SecretReadResult{Name: name, Value: strings.TrimSpace(string(out)), Source: "pass"}, nil
		}
	}
	// Fall back to file
	home := os.Getenv("HOME")
	path := fmt.Sprintf("%s/.dasheng/secrets/%s", home, name)
	if v, err := os.ReadFile(path); err == nil {
		return SecretReadResult{Name: name, Value: strings.TrimSpace(string(v)), Source: "file"}, nil
	}
	return SecretReadResult{}, fmt.Errorf("secret not found: %s", name)
}

// helper to allow nil params
func rawOrEmpty(raw json.RawMessage) json.RawMessage {
	return raw
}

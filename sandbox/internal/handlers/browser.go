// browser.go — browser.navigate + browser.extract
//
// v0.3 spec §15.9 — 浏览器自动化
// Phase 3: 走 playwright CLI (subprocess), 简化版
// Phase 4: 接 Playwright Python daemon (跟 deerflow 一起)
package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

type BrowserNavigateParams struct {
	URL     string `json:"url"`
	Timeout int    `json:"timeout_ms"`
}

type BrowserNavigateResult struct {
	Status   int    `json:"status"`
	Title    string `json:"title"`
	FinalURL string `json:"final_url"`
}

func BrowserNavigate(params json.RawMessage) (interface{}, error) {
	p, err := jsonParams[BrowserNavigateParams](params)
	if err != nil {
		return nil, err
	}
	if !strings.HasPrefix(p.URL, "http://") && !strings.HasPrefix(p.URL, "https://") {
		return nil, fmt.Errorf("invalid url: %s (must be http/https)", p.URL)
	}
	if p.Timeout == 0 {
		p.Timeout = 15000
	}
	// Phase 3 stub: return mock response if no playwright, or DASHE_BROWSER_MOCK=1
	if os.Getenv("DASHE_BROWSER_MOCK") == "1" {
		return BrowserNavigateResult{Status: 200, Title: "Mock: " + p.URL, FinalURL: p.URL}, nil
	}
	if _, err := exec.LookPath("playwright"); err != nil {
		return BrowserNavigateResult{
			Status:   200,
			Title:    "Mock: " + p.URL,
			FinalURL: p.URL,
		}, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(p.Timeout)*time.Millisecond)
	defer cancel()
	cmd := exec.CommandContext(ctx, "playwright", "navigate", "--url", p.URL, "--json")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("playwright navigate failed: %w (%s)", err, stderr.String())
	}
	var out BrowserNavigateResult
	if err := json.Unmarshal(stdout.Bytes(), &out); err != nil {
		return nil, fmt.Errorf("parse playwright output: %w", err)
	}
	return out, nil
}

type BrowserExtractParams struct {
	URL      string `json:"url"`
	Selector string `json:"selector"`
	Timeout  int    `json:"timeout_ms"`
}

type BrowserExtractResult struct {
	Text  string   `json:"text"`
	HTML  string   `json:"html"`
	Links []string `json:"links"`
}

func BrowserExtract(params json.RawMessage) (interface{}, error) {
	p, err := jsonParams[BrowserExtractParams](params)
	if err != nil {
		return nil, err
	}
	if p.URL == "" {
		return nil, fmt.Errorf("url is required")
	}
	if p.Timeout == 0 {
		p.Timeout = 15000
	}
	// Phase 3 stub
	if os.Getenv("DASHE_BROWSER_MOCK") == "1" {
		return BrowserExtractResult{Text: "Mock extract from " + p.URL, HTML: "<html><body>mock</body></html>", Links: []string{"https://example.com"}}, nil
	}
	if _, err := exec.LookPath("playwright"); err != nil {
		return BrowserExtractResult{
			Text:  "Mock extract from " + p.URL,
			HTML:  "<html><body>mock</body></html>",
			Links: []string{"https://example.com"},
		}, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(p.Timeout)*time.Millisecond)
	defer cancel()
	args := []string{"extract", "--url", p.URL, "--json"}
	if p.Selector != "" {
		args = append(args, "--selector", p.Selector)
	}
	cmd := exec.CommandContext(ctx, "playwright", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("playwright extract failed: %w (%s)", err, stderr.String())
	}
	var out BrowserExtractResult
	if err := json.Unmarshal(stdout.Bytes(), &out); err != nil {
		return nil, fmt.Errorf("parse playwright output: %w", err)
	}
	return out, nil
}

// skill.go — skill.list + skill.load
//
// v0.3 spec §15.6 — skill 注册表, 从 ~/.dasheng/skills/ 加载
// 目录结构: <skill_root>/<skill_id>/SKILL.md
package handlers

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type SkillInfo struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Category    string   `json:"category"`
	Tags        []string `json:"tags"`
	Path        string   `json:"path"`
}

type SkillStore struct {
	root string
}

func NewSkillStore() *SkillStore {
	root := os.Getenv("DASHE_SKILLS_ROOT")
	if root == "" {
		home := os.Getenv("HOME")
		root = filepath.Join(home, ".dasheng", "skills")
	}
	// Make sure root exists
	_ = os.MkdirAll(root, 0o755)
	return &SkillStore{root: root}
}

// --- skill.list ---

type SkillListParams struct {
	Category string `json:"category"`
}

type SkillListResult struct {
	Skills []SkillInfo `json:"skills"`
}

func SkillList(store *SkillStore) func(json.RawMessage) (interface{}, error) {
	return func(raw json.RawMessage) (interface{}, error) {
		p, _ := jsonParams[SkillListParams](raw)
		entries, err := os.ReadDir(store.root)
		if err != nil {
			return nil, fmt.Errorf("read skills dir: %w", err)
		}
		var out []SkillInfo
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			id := e.Name()
			manifest, err := readSkillManifest(filepath.Join(store.root, id))
			if err != nil {
				// Skip malformed skills but don't fail the whole list
				continue
			}
			if p.Category != "" && manifest.Category != p.Category {
				continue
			}
			manifest.ID = id
			manifest.Path = filepath.Join(store.root, id)
			out = append(out, *manifest)
		}
		return SkillListResult{Skills: out}, nil
	}
}

// --- skill.load ---

type SkillLoadParams struct {
	ID string `json:"id"`
}

type SkillLoadResult struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Category    string   `json:"category"`
	Tags        []string `json:"tags"`
	Manifest    string   `json:"manifest"`
	Body        string   `json:"body"`
}

func SkillLoad(store *SkillStore) func(json.RawMessage) (interface{}, error) {
	return func(raw json.RawMessage) (interface{}, error) {
		p, err := jsonParams[SkillLoadParams](raw)
		if err != nil {
			return nil, err
		}
		if p.ID == "" {
			return nil, fmt.Errorf("id is required")
		}
		// Sanitize: skill IDs are filesystem dir names; no slashes, no .., no abs
		if strings.ContainsAny(p.ID, "/\\") || strings.Contains(p.ID, "..") || strings.HasPrefix(p.ID, ".") {
			return nil, fmt.Errorf("invalid skill id: %s", p.ID)
		}
		skillDir := filepath.Join(store.root, p.ID)
		if _, err := os.Stat(skillDir); err != nil {
			return nil, fmt.Errorf("skill not found: %s", p.ID)
		}
		manifest, err := readSkillManifest(skillDir)
		if err != nil {
			return nil, err
		}
		manifestRaw, _ := os.ReadFile(filepath.Join(skillDir, "SKILL.md"))
		body, _ := os.ReadFile(filepath.Join(skillDir, "body.md"))
		return SkillLoadResult{
			ID:          p.ID,
			Name:        manifest.Name,
			Description: manifest.Description,
			Category:    manifest.Category,
			Tags:        manifest.Tags,
			Manifest:    string(manifestRaw),
			Body:        string(body),
		}, nil
	}
}

// readSkillManifest parses the front-matter of SKILL.md.
// Format: simple key: value lines at the top, separated by --- from body.
func readSkillManifest(skillDir string) (*SkillInfo, error) {
	raw, err := os.ReadFile(filepath.Join(skillDir, "SKILL.md"))
	if err != nil {
		return nil, err
	}
	text := string(raw)
	// Expect: "---\n<yaml-like>\n---\n<body>"
	parts := strings.SplitN(text, "---", 3)
	if len(parts) < 3 {
		return nil, fmt.Errorf("SKILL.md missing front-matter")
	}
	front := parts[1]
	out := &SkillInfo{}
	for _, line := range strings.Split(front, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		idx := strings.Index(line, ":")
		if idx < 0 {
			continue
		}
		key := strings.TrimSpace(line[:idx])
		val := strings.TrimSpace(line[idx+1:])
		val = strings.Trim(val, "\"'")
		switch key {
		case "name":
			out.Name = val
		case "description":
			out.Description = val
		case "category":
			out.Category = val
		case "tags":
			for _, t := range strings.Split(val, ",") {
				t = strings.TrimSpace(t)
				if t != "" {
					out.Tags = append(out.Tags, t)
				}
			}
		}
	}
	if out.Name == "" {
		return nil, fmt.Errorf("SKILL.md missing 'name'")
	}
	return out, nil
}

# DaShengOS Go Sandbox · v0.3 Phase 3+4
#
# Usage:
#   make build          — compile bin/sandbox + bin/supervisord
#   make run            — build + start daemon in foreground
#   make supervisord    — start supervisord (manages 1 sandbox)
#   make test           — run Python e2e (daemon must be running)
#   make test-unit      — run Go unit tests
#   make test-all       — run all 3 layers (unit + integration + e2e)
#   make docker-build   — build the distroless Docker image
#   make docker-up      — docker compose up (sandbox + supervisord + prom + grafana)
#   make docker-down    — docker compose down
#   make k8s-apply      — kubectl apply -f deploy/k8s/
#   make clean          — remove build artifacts
#   make fmt            — gofmt
#   make lint           — go vet
#   make install-deps   — go mod download

BINARIES := bin/sandbox bin/supervisord
SOCKET ?= /tmp/dasheng/sandbox.sock
PYTHON ?= python3
IMAGE ?= dasheng/sandbox:v0.3.0-phase4
K8S_DIR ?= deploy/k8s

.PHONY: build run supervisord test test-unit test-all clean fmt lint install-deps docker-build docker-up docker-down k8s-apply help

help:
	@echo "DaShengOS Go Sandbox · v0.3 Phase 3+4"
	@echo ""
	@echo "Targets:"
	@echo "  build         - Compile $(BINARIES)"
	@echo "  run           - Build + run sandbox in foreground"
	@echo "  supervisord   - Run supervisord (manages 1 sandbox worker)"
	@echo "  test          - Python e2e (daemon must be running)"
	@echo "  test-unit     - Go unit tests"
	@echo "  test-all      - All 3 test layers"
	@echo "  docker-build  - Build the distroless image"
	@echo "  docker-up     - docker compose up (sandbox+prom+grafana)"
	@echo "  docker-down   - docker compose down -v"
	@echo "  k8s-apply     - kubectl apply -f deploy/k8s/"
	@echo "  clean         - Remove build artifacts"
	@echo "  fmt           - gofmt"
	@echo "  lint          - go vet"

build:
	@mkdir -p bin
	go build -o bin/sandbox ./cmd/sandbox
	go build -o bin/supervisord ./cmd/supervisord

run: build
	DASHE_SANDBOX_SOCKET=$(SOCKET) ./bin/sandbox

supervisord: build
	./bin/supervisord -bin ./bin/sandbox -workers 1 -health-period 5s

test: build
	@mkdir -p $$HOME/.dasheng/secrets
	@echo "e2e-test-secret-12345" > $$HOME/.dasheng/secrets/test-token
	@DASHE_SANDBOX_SOCKET=$(SOCKET) DASHE_BROWSER_MOCK=1 ./bin/sandbox > /tmp/sandbox.log 2>&1 & \
	  sleep 1; \
	  DASHE_SANDBOX_SOCKET=$(SOCKET) $(PYTHON) test_e2e.py; \
	  CODE=$$?; \
	  pkill -f "bin/sandbox" || true; \
	  exit $$CODE

test-unit:
	go test ./... -v

test-all: test-unit test
	@echo "✅ all 3 test layers passed (unit + integration + e2e)"

docker-build: build
	docker build -f deploy/Dockerfile -t $(IMAGE) .
	@echo "✅ image built: $(IMAGE)"

docker-up: docker-build
	docker compose -f deploy/docker-compose.yml up -d
	@echo "✅ stack up. Grafana: http://127.0.0.1:3001 (admin/admin)"
	@echo "                Prometheus: http://127.0.0.1:9090"

docker-down:
	docker compose -f deploy/docker-compose.yml down -v

k8s-apply:
	kubectl apply -f $(K8S_DIR)/sandbox-deployment.yaml
	@echo "✅ k8s manifests applied. Pods in namespace 'dasheng'."

clean:
	rm -rf bin

fmt:
	gofmt -w .

lint:
	go vet ./...

install-deps:
	go mod download


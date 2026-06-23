# DaShengOS System Configuration

## Ports
- 8000: Backend API (Fastify)
- 3000: Frontend (Node HTTP server serving dist)
- 3001: Open Design web
- 7456: Open Design daemon
- 6379: Redis
- 8080: Qwen Local (optional)
- 11434: Ollama (optional)

## Restart Commands
```bash
# Backend
screen -S dasheng-backend -X quit
pkill -9 -f "tsx.*server"
cd /Users/apple/Desktop/ai-workbench-v2/packages/backend
screen -dmS dasheng-backend bash -c 'npx tsx src/server.ts 2>&1 | tee /tmp/dasheng-backend.log'

# Frontend
pkill -9 -f "node -e.*apps/web"
cd /Users/apple/Desktop/ai-workbench-v2/apps/web
screen -dmS dasheng-frontend node -e '...'  # serves dist on :3000, proxy /api → :8000

# Frontend rebuild
cd /Users/apple/Desktop/ai-workbench-v2/apps/web && npx vite build
```

## Login
- URL: http://localhost:3000/login
- Username: admin
- Password: dasheng123

## Environment
- .env location: packages/backend/.env
- LLM_PROVIDER: deepseek
- DEEPSEEK_API_KEY: configured
- DEEPSEEK_DEFAULT_MODEL: deepseek-v4-pro

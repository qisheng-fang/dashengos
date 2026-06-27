#!/usr/bin/env python3
"""DaShengOS 精简后端 — 纯 Python，零编译，端口 8000"""
import http.server, json, base64, random, os, time, threading, urllib.parse, socketserver, subprocess, sqlite3
import requests, qrcode

PORT = 8000
QR_FILE = '/Users/apple/Desktop/ai-workbench-v2/apps/web/public/wechat-qr.png'
MEMORY = '/Users/apple/Desktop/ai-workbench-v2/data/wiki/MEMORY.md'
DEEPSEEK_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"
AUTOFILE = '/Users/apple/Desktop/ai-workbench-v2/data/automations.json'
MARKETPLACE_FILE = '/Users/apple/Desktop/ai-workbench-v2/data/marketplace_data.json'
DB_FILE = '/Users/apple/Desktop/ai-workbench-v2/packages/backend/data/dasheng.db'

def _load_marketplace():
    try:
        with open(MARKETPLACE_FILE, 'r') as f:
            data = json.load(f)
        return data.get('catalog', []), data.get('categories', [])
    except Exception:
        return [], []

def search_marketplace(query='', category='all'):
    catalog, _ = _load_marketplace()
    if category and category != 'all':
        catalog = [s for s in catalog if s.get('category') == category]
    if query:
        q = query.lower()
        catalog = [s for s in catalog if
                   q in s.get('name', '').lower() or
                   q in s.get('description', '').lower() or
                   any(q in t.lower() for t in s.get('manifest', {}).get('tags', []))]
    return catalog

_session = {'key': '', 'status': 'idle', 'account': '', 'token': ''}
_qr_ready = threading.Event()

def _do_fetch_qr():
    try:
        uin = base64.b64encode(str(random.getrandbits(32)).encode()).decode()
        h = {'Content-Type':'application/json','AuthorizationType':'ilink_bot_token','X-WECHAT-UIN':uin,'iLink-App-ClientVersion':'1'}
        r = requests.get('https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode', params={'bot_type':'3'}, headers=h, timeout=10)
        d = r.json()
        url = d.get('qrcode_img_content','')
        key = d.get('qrcode','')
        if url and key:
            img = qrcode.make(url)
            img.save(QR_FILE)
            _session['key'] = key
            _session['status'] = 'wait'
            _session['account'] = ''
            _session['token'] = ''
            _qr_ready.set()
            return True
    except Exception as e:
        print(f'[QR] 生成失败: {e}')
    return False

def refresh_qr():
    _qr_ready.clear()
    _do_fetch_qr()

def ensure_qr():
    if not _qr_ready.is_set() or _session['status'] in ('expired', 'confirmed'):
        refresh_qr()

def check_qr():
    if not _session['key']: return
    try:
        uin = base64.b64encode(str(random.getrandbits(32)).encode()).decode()
        h = {'Content-Type':'application/json','AuthorizationType':'ilink_bot_token','X-WECHAT-UIN':uin,'iLink-App-ClientVersion':'1'}
        r = requests.get('https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status', params={'qrcode':_session['key']}, headers=h, timeout=15)
        d = r.json()
        status = d.get('status','')
        if status == 'confirmed' or d.get('bot_token'):
            _session['status'] = 'confirmed'
            _session['token'] = d.get('bot_token','')
            _session['account'] = d.get('ilink_bot_id','') or d.get('ilink_user_id','')
            sf = os.path.expanduser('~/.dasheng-wechat-state.json')
            s = {}
            try:
                with open(sf) as f: s = json.load(f)
            except: pass
            s['token'] = _session['token']; s['account_id'] = _session['account']; s['sync_buf'] = ''
            with open(sf,'w') as f: json.dump(s,f)
            try:
                with open('/tmp/dasheng-bridge-reload', 'w') as rf: rf.write('reload')
            except: pass
        elif status == 'scanned':
            _session['status'] = 'scanned'
        elif status == 'expired':
            _session['key'] = ''
            _session['status'] = 'expired'
            _qr_ready.clear()
    except requests.Timeout: pass
    except Exception as e: pass

def qr_daemon():
    _do_fetch_qr()
    while True:
        time.sleep(3)
        check_qr()

def ai_reply(message, history=None):
    sys_prompt = '你是爱尤趣品牌的智能客服助手。请用友好、专业的语气回复客户问题。规则：1.回复简洁200字以内 2.遇到产品问题先致歉再给方案 3.无法回答时引导联系人工客服 4.支持中英文双语 5.语气温暖不啰嗦'
    msgs = [{'role':'system','content':sys_prompt}]
    if history: msgs.extend(history)
    msgs.append({'role':'user','content':message})
    try:
        r = requests.post(DEEPSEEK_URL,
            headers={'Authorization':f'Bearer {DEEPSEEK_KEY}','Content-Type':'application/json'},
            json={'model':'deepseek-chat','messages':msgs,'max_tokens':500,'temperature':0.7},
            timeout=20)
        return r.json()['choices'][0]['message']['content']
    except Exception as e:
        return f'抱歉，智能客服暂时无法响应。请稍后再试或联系人工客服。'

def knowledge_search(query):
    try:
        with open(MEMORY) as f: content = f.read()
    except: content = ''
    lines = content.split('\n')
    matched = [l for l in lines if query.lower() in l.lower()]
    return '\n'.join(matched[:10]) if matched else ''

class H(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS')
        self.send_header('Access-Control-Allow-Headers','Content-Type,Authorization')

    def _send(self, ct, body, code=200):
        self.send_response(code)
        self.send_header('Content-Type', ct)
        self._cors()
        self.end_headers()
        self.wfile.write(body if isinstance(body, bytes) else body.encode())

    def _json(self, data, code=200):
        self._send('application/json', json.dumps(data, ensure_ascii=False), code)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        p = urllib.parse.urlparse(self.path).path
        if p in ('/health', '/api/v1/health/ping'):
            return self._json({'status':'ok','version':'mini-1.0'})

        if p == '/api/v1/wechat-qr-url':
            ensure_qr()
            if _qr_ready.is_set():
                return self._json({'url':'/wechat-qr.png','status':_session['status'],'key':_session['key']})
            return self._json({'error':'QR生成中，请稍后刷新'}, 503)

        if p == '/api/v1/wechat-qr-status':
            return self._json({'status':_session['status'],'account':_session['account']})

        if p == '/api/v1/wechat-bridge/status':
            r = subprocess.run(["screen","-ls","wxbridge"], capture_output=True, text=True)
            return self._json({"running": "wxbridge" in r.stdout})

        if p == '/api/v1/automations':
            try:
                with open(AUTOFILE) as f: data = json.load(f)
            except: data = []
            return self._json(data)

        if p == '/api/v1/mcp/servers':
            return self._json({"servers": []})

        if p == '/api/v1/skills/marketplace':
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            query = qs.get('search', [''])[0]
            cat = qs.get('category', ['all'])[0]
            results = search_marketplace(query, cat)
            _, categories = _load_marketplace()
            return self._json({"skills": results, "categories": categories})

        if p == '/api/v1/skills/marketplace/categories':
            _, categories = _load_marketplace()
            return self._json({"categories": categories})

        if p == '/api/v1/sessions':
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            limit = min(int(qs.get('limit', ['20'])[0]), 100)
            try:
                db = sqlite3.connect(DB_FILE)
                db.row_factory = sqlite3.Row
                rows = db.execute(
                    'SELECT id, title, agent_id, model, status, token_count, created_at, updated_at FROM sessions ORDER BY updated_at DESC LIMIT ?',
                    (limit,)
                ).fetchall()
                db.close()
                return self._json({'sessions': [dict(r) for r in rows]})
            except Exception as e:
                return self._json({'error': str(e)}, 500)

        if p.startswith('/api/v1/sessions/') and p.endswith('/messages'):
            sid = p.split('/')[-2]
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            limit = min(int(qs.get('limit', ['50'])[0]), 200)
            try:
                db = sqlite3.connect(DB_FILE)
                db.row_factory = sqlite3.Row
                sess = db.execute('SELECT id FROM sessions WHERE id = ?', (sid,)).fetchone()
                if not sess:
                    db.close()
                    return self._json({'error': 'Session not found'}, 404)
                rows = db.execute(
                    'SELECT id, role, content, model, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?',
                    (sid, limit)
                ).fetchall()
                db.close()
                return self._json({'messages': [dict(r) for r in rows]})
            except Exception as e:
                return self._json({'error': str(e)}, 500)

        if p.startswith('/api/v1/sessions/') and p.count('/') == 4:
            sid = p.split('/')[-1]
            try:
                db = sqlite3.connect(DB_FILE)
                db.row_factory = sqlite3.Row
                row = db.execute('SELECT * FROM sessions WHERE id = ?', (sid,)).fetchone()
                db.close()
                if not row:
                    return self._json({'error': 'Session not found'}, 404)
                return self._json(dict(row))
            except Exception as e:
                return self._json({'error': str(e)}, 500)

        self._json({'error':'not found'}, 404)

    def do_POST(self):
        p = urllib.parse.urlparse(self.path).path
        length = int(self.headers.get('Content-Length', 0))
        body = {}
        if length > 0:
            try: body = json.loads(self.rfile.read(length))
            except: pass

        if p == '/api/v1/auth/login':
            return self._json({
                'access_token': 'eyJhbGciOiJIUzI1NiJ9.dasheng_admin_token',
                'refresh_token': 'eyJhbGciOiJIUzI1NiJ9.dasheng_refresh_token',
                'expires_in': 8640000,
                'user': {'id':'admin-001','username':body.get('username','admin'),'email':'admin@dasheng.local','role':'ADMIN','avatar':'','provider':'local'}
            })

        if p == '/api/v1/auth/logout':
            return self._json({'ok':True})

        if p == '/api/v1/sessions':
            if self.command == 'GET':
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                limit = min(int(qs.get('limit', ['20'])[0]), 100)
                try:
                    db = sqlite3.connect(DB_FILE)
                    db.row_factory = sqlite3.Row
                    rows = db.execute(
                        'SELECT id, title, agent_id, model, status, token_count, created_at, updated_at FROM sessions ORDER BY updated_at DESC LIMIT ?',
                        (limit,)
                    ).fetchall()
                    db.close()
                    return self._json({'sessions': [dict(r) for r in rows]})
                except Exception as e:
                    return self._json({'error': str(e)}, 500)
            elif self.command == 'POST':
                title = body.get('title', '新会话')
                agent_id = body.get('agent_id', 'default')
                model = body.get('model', 'deepseek-chat')
                sid = f'sess_{int(time.time()*1000)}_{random.randint(1000,9999)}'
                now = int(time.time() * 1000)
                try:
                    db = sqlite3.connect(DB_FILE)
                    db.execute(
                        "INSERT INTO sessions (id, user_id, agent_id, title, model, status, token_count, created_at, updated_at) VALUES (?, 'admin-001', ?, ?, ?, 'ACTIVE', 0, ?, ?)",
                        (sid, agent_id, title, model, now, now)
                    )
                    db.commit()
                    db.close()
                    return self._json({'id': sid, 'title': title, 'status': 'ACTIVE'})
                except Exception as e:
                    return self._json({'error': str(e)}, 500)

        if p.startswith('/api/v1/sessions/') and not p.endswith('/messages') and p.count('/') == 4:
            sid = p.split('/')[-1]
            if self.command == 'GET':
                try:
                    db = sqlite3.connect(DB_FILE)
                    db.row_factory = sqlite3.Row
                    row = db.execute('SELECT * FROM sessions WHERE id = ?', (sid,)).fetchone()
                    db.close()
                    if not row:
                        return self._json({'error': 'Session not found'}, 404)
                    return self._json(dict(row))
                except Exception as e:
                    return self._json({'error': str(e)}, 500)
            elif self.command == 'DELETE':
                try:
                    db = sqlite3.connect(DB_FILE)
                    db.execute('DELETE FROM messages WHERE session_id = ?', (sid,))
                    db.execute('DELETE FROM sessions WHERE id = ?', (sid,))
                    db.commit()
                    db.close()
                    return self._json({'id': sid, 'deleted': True})
                except Exception as e:
                    return self._json({'error': str(e)}, 500)
            elif self.command == 'PATCH':
                title = body.get('title', '')
                if title:
                    try:
                        db = sqlite3.connect(DB_FILE)
                        db.execute('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?', (title, int(time.time()*1000), sid))
                        db.commit()
                        db.close()
                        return self._json({'id': sid, 'title': title})
                    except Exception as e:
                        return self._json({'error': str(e)}, 500)
                return self._json({'error': 'title required'}, 400)

        if p.startswith('/api/v1/sessions/') and p.endswith('/messages'):
            parts = p.split('/')
            sid = parts[-2]  # /api/v1/sessions/{id}/messages → id is second-to-last
            if self.command == 'GET':
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                limit = min(int(qs.get('limit', ['50'])[0]), 200)
                try:
                    db = sqlite3.connect(DB_FILE)
                    db.row_factory = sqlite3.Row
                    # Check session exists
                    sess = db.execute('SELECT id FROM sessions WHERE id = ?', (sid,)).fetchone()
                    if not sess:
                        db.close()
                        return self._json({'error': 'Session not found'}, 404)
                    rows = db.execute(
                        'SELECT id, role, content, model, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?',
                        (sid, limit)
                    ).fetchall()
                    db.close()
                    return self._json({'messages': [dict(r) for r in rows]})
                except Exception as e:
                    return self._json({'error': str(e)}, 500)
            elif self.command == 'POST':
                content_msg = body.get('content', '')
                if not content_msg:
                    return self._json({'error': 'content required'}, 400)
                model_name = body.get('model', 'deepseek-chat')
                now = int(time.time() * 1000)
                user_msg_id = f'msg_{now}_{random.randint(1000,9999)}'
                try:
                    db = sqlite3.connect(DB_FILE)
                    # Save user message
                    db.execute(
                        "INSERT INTO messages (id, session_id, role, content, model, created_at) VALUES (?, ?, 'USER', ?, ?, ?)",
                        (user_msg_id, sid, content_msg, model_name, now)
                    )
                    db.commit()
                    db.close()
                    return self._json({
                        'session_id': sid,
                        'message_id': user_msg_id,
                        'content': content_msg,
                        'role': 'USER',
                        'timestamp': now
                    })
                except Exception as e:
                    return self._json({'error': str(e)}, 500)

        if p == '/api/v1/astrbot/cs-reply':
            msg = body.get('message','')
            if not msg: return self._json({'error':'message required'}, 400)
            reply = ai_reply(msg, body.get('history'))
            return self._json({'success':True,'reply':reply,'platform':body.get('platform'),'user_id':body.get('user_id')})

        if p == '/api/v1/astrbot/cs-knowledge':
            q = body.get('query','')
            if not q: return self._json({'error':'query required'}, 400)
            ctx = knowledge_search(q)
            return self._json({'success':True,'context':ctx,'query':q})

        if p == '/api/v1/chat/stream':
            msg = body.get('message','')
            if not msg: return self._json({'error':'message required'}, 400)
            history = body.get('history',[])
            msgs = [{'role':'system','content':'你是 DaShengOS AI 助手，一个全能的编程和知识助手。请简洁准确地回答问题。'}]
            if history:
                for h in history[-20:]:
                    msgs.append({'role':h.get('role','user'),'content':h.get('content','')})
            msgs.append({'role':'user','content':msg})
            self.send_response(200)
            self.send_header('Content-Type','text/event-stream')
            self._cors()
            self.end_headers()
            try:
                self.wfile.write('event: status\ndata: {"t":"思考中..."}\n\n'.encode()); self.wfile.flush()
                r = requests.post(DEEPSEEK_URL,
                    headers={'Authorization':f'Bearer {DEEPSEEK_KEY}','Content-Type':'application/json'},
                    json={'model':'deepseek-chat','messages':msgs,'max_tokens':2000,'temperature':0.7,'stream':True},
                    timeout=60, stream=True)
                for line in r.iter_lines():
                    if line:
                        ls = line.decode('utf-8') if isinstance(line,bytes) else line
                        if ls.startswith('data: '):
                            data = ls[6:]
                            if data == '[DONE]':
                                self.wfile.write(b'event: done\ndata: {}\n\n'); break
                            try:
                                chunk = json.loads(data)
                                c = chunk.get('choices',[{}])[0].get('delta',{}).get('content','')
                                if c:
                                    self.wfile.write(f'event: token\ndata: {{"c":{json.dumps(c)}}}\n\n'.encode())
                            except: pass
                    self.wfile.flush()
            except Exception as e:
                self.wfile.write(f'event: error\ndata: {{"m":{json.dumps(str(e))}}}\n\n'.encode())
                self.wfile.write(b'event: done\ndata: {}\n\n')
            return

        if p == '/api/v1/wechat-qr-refresh':
            refresh_qr()
            return self._json({'success':True,'status':_session['status']})

        if p == '/api/v1/wechat-bridge/start':
            subprocess.run(["screen","-dmS","wxbridge","python3","/Users/apple/Desktop/ai-workbench-v2/scripts/wechat-clipboard-bridge.py"])
            return self._json({"success":True,"message":"已启动"})

        if p == '/api/v1/wechat-bridge/stop':
            subprocess.run(["screen","-S","wxbridge","-X","quit"])
            return self._json({"success":True,"message":"已停止"})

        if p.startswith('/api/v1/mcp/servers/') and len(p.split('/')) >= 6:
            return self._json({"ok": True})

        if p == '/api/v1/skills/install':
            return self._json({"ok": True, "message": "技能安装成功"})

        if p.startswith('/api/v1/skills/') and p.endswith('/uninstall'):
            return self._json({"ok": True, "message": "技能已卸载"})

        if p == '/api/v1/terminal/exec':
            cmd = body.get('command','')
            if not cmd: return self._json({'error':'command required'}, 400)
            cwd = body.get('cwd','/Users/apple/Desktop/ai-workbench-v2')
            try:
                r = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True, timeout=30)
                out = (r.stdout or '') + ('\n' + r.stderr if r.stderr else '')
                return self._json({'output': out, 'exit_code': r.returncode})
            except subprocess.TimeoutExpired:
                return self._json({'error': '命令执行超时 (30s)', 'exit_code': -1})
            except Exception as e:
                return self._json({'error': str(e), 'exit_code': -1})

        if p == '/api/v1/automations':
            try:
                with open(AUTOFILE) as f: data = json.load(f)
            except: data = []
            item = {
                'id': f'auto-{int(time.time()*1000)}',
                'name': body.get('name','新任务'),
                'description': body.get('description',''),
                'trigger_type': body.get('trigger_type','cron'),
                'cron_expr': body.get('cron_expr','0 8 * * *'),
                'action': body.get('action','custom'),
                'params': body.get('params',{}),
                'status': 'active',
                'last_run_at': None, 'next_run_at': None, 'run_count': 0,
                'created_at': int(time.time()*1000)
            }
            data.append(item)
            os.makedirs(os.path.dirname(AUTOFILE), exist_ok=True)
            with open(AUTOFILE,'w') as f: json.dump(data,f,ensure_ascii=False)
            return self._json(item)

        if p.startswith('/api/v1/automations/'):
            aid = p.split('/')[-1]
            try:
                with open(AUTOFILE) as f: data = json.load(f)
            except: data = []
            if self.command == 'DELETE':
                data = [item for item in data if item.get('id')!=aid]
                with open(AUTOFILE,'w') as f: json.dump(data,f,ensure_ascii=False)
                return self._json({'ok':True})
            if self.command == 'PUT':
                for item in data:
                    if item.get('id')==aid:
                        item.update({k:v for k,v in body.items() if k!='id'})
                        break
                with open(AUTOFILE,'w') as f: json.dump(data,f,ensure_ascii=False)
                return self._json({'ok':True})

        self._json({'error':'not found'}, 404)

    def log_message(self, *a): pass

class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True

if __name__ == '__main__':
    threading.Thread(target=qr_daemon, daemon=True).start()
    print(f'🚀 Mini Backend: http://0.0.0.0:{PORT}')
    ThreadingHTTPServer(('0.0.0.0',PORT), H).serve_forever()

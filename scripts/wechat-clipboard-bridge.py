#!/usr/bin/env python3
"""
微信剪贴板桥接 — 智能客服 v2.0
原理：在桌面微信里复制消息(Cmd+C) → 守护进程检测到 → DeepSeek 生成回复 → 自动粘贴回复(Cmd+V Enter)
"""
import subprocess, time, json, os, sys, re, threading, hashlib
import requests
from AppKit import NSPasteboard, NSPasteboardTypeString

CS_API = "http://127.0.0.1:8000/api/v1/astrbot/cs-reply"
POLL_INTERVAL = 0.5

def get_clipboard():
    pb = NSPasteboard.generalPasteboard()
    if pb.types() and NSPasteboardTypeString in pb.types():
        return pb.stringForType_(NSPasteboardTypeString) or ""
    return ""

def ai_reply(text, user_id="wx_user"):
    try:
        r = requests.post(CS_API, json={
            "message": text,
            "user_id": user_id,
            "platform": "wechat_clipboard"
        }, timeout=15)
        data = r.json()
        return data.get("reply", "") if data.get("success") else ""
    except Exception as e:
        print(f"  ⚠️ AI error: {e}")
        return ""

def type_reply(text):
    pb = NSPasteboard.generalPasteboard()
    pb.clearContents()
    pb.setString_forType_(text, NSPasteboardTypeString)
    time.sleep(0.1)
    script = '''
    tell application "System Events"
        tell process "微信"
            set frontmost to true
            keystroke "v" using command down
            delay 0.2
            keystroke return
        end tell
    end tell
    '''
    try:
        subprocess.run(["osascript", "-e", script], timeout=3)
        return True
    except Exception as e:
        print(f"  ⚠️ Type error: {e}")
        return False

def main():
    print("🔍 微信剪贴板桥接已启动")
    print("   用法：在微信中选中消息 → Cmd+C 复制 → AI 自动回复")
    print("   Ctrl+C 停止\n")
    
    last_hash = ""
    processed = set()
    
    while True:
        try:
            text = get_clipboard()
            if not text or len(text) < 2:
                time.sleep(POLL_INTERVAL)
                continue
            
            h = hashlib.md5(text.encode()).hexdigest()
            if h == last_hash or h in processed:
                time.sleep(POLL_INTERVAL)
                continue
            
            last_hash = h
            processed.add(h)
            if len(processed) > 200:
                processed = set(list(processed)[-100:])
            
            sender = "wx_user"
            msg = text.strip()
            
            lines = msg.split('\n', 1)
            if len(lines) == 2 and len(lines[0]) < 30:
                sender = lines[0].strip()
                msg = lines[1].strip()
            
            print(f"\n📩 [{sender[:20]}]: {msg[:80]}")
            
            reply = ai_reply(msg, sender)
            if reply:
                print(f"🤖 → {reply[:80]}")
                ok = type_reply(reply)
                print(f"   {'✅ 已发送' if ok else '❌ 发送失败'}")
            else:
                print(f"   ⚠️ AI 无回复")
            
        except KeyboardInterrupt:
            print("\n👋 已停止")
            break
        except Exception as e:
            print(f"⚠️ {e}")
            time.sleep(1)

if __name__ == "__main__":
    main()

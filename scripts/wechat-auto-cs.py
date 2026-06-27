#!/usr/bin/env python3
"""
微信全自动智能客服 v3.0
原理: 定时截取微信窗口 → OCR识别 → 检测新消息 → DeepSeek生成回复 → 自动发送
零人工干预, 只需要电脑登录微信并打开客服对话窗口
"""
import subprocess, time, json, os, hashlib, re, sys, threading
import requests
from AppKit import NSPasteboard, NSPasteboardTypeString
from PIL import Image

CS_API = "http://127.0.0.1:8000/api/v1/astrbot/cs-reply"
SCREENSHOT_PATH = "/tmp/wechat_cs_screenshot.png"
OCR_TEXT_PATH = "/tmp/wechat_cs_ocr"
POLL_INTERVAL = 3  # 每3秒检测一次
TESSERACT_CMD = "/usr/local/Homebrew/bin/tesseract"

def get_wechat_bounds():
    """获取微信窗口的位置和大小"""
    script = '''
    tell application "System Events"
        tell process "WeChat"
            set p to position of window 1
            set s to size of window 1
            return ((item 1 of p) as string) & "," & ((item 2 of p) as string) & "," & ((item 1 of s) as string) & "," & ((item 2 of s) as string)
        end tell
    end tell
    '''
    r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=5)
    parts = r.stdout.strip().split(',')
    if len(parts) == 4:
        return int(parts[0]), int(parts[1]), int(parts[2]), int(parts[3])
    return None

def capture_chat():
    """截取微信窗口的核心聊天区域"""
    bounds = get_wechat_bounds()
    if not bounds:
        return None
    x, y, w, h = bounds
    
    # 微信窗口: 顶部约 50px 是标题栏/搜索, 底部约 100px 是输入框
    # 只截取中间的聊天内容区域
    chat_x = x + 10
    chat_y = y + 50
    chat_w = w - 20
    chat_h = h - 150
    
    subprocess.run([
        "screencapture", "-R", f"{chat_x},{chat_y},{chat_w},{chat_h}",
        SCREENSHOT_PATH
    ], timeout=3, capture_output=True)
    
    if os.path.exists(SCREENSHOT_PATH):
        return SCREENSHOT_PATH
    return None

def ocr_text(image_path):
    """OCR 识别图片中的文本"""
    try:
        subprocess.run([
            TESSERACT_CMD, image_path, OCR_TEXT_PATH,
            "-l", "chi_sim+eng", "--psm", "6"
        ], timeout=10, capture_output=True)
        
        txt_file = OCR_TEXT_PATH + ".txt"
        if os.path.exists(txt_file):
            with open(txt_file, 'r') as f:
                return f.read().strip()
    except Exception as e:
        print(f"  OCR error: {e}")
    return ""

def parse_last_message(text):
    """解析 OCR 文本, 提取最后一条外部用户发的消息"""
    if not text:
        return None
    
    lines = text.strip().split('\n')
    # 过滤空白行和噪音
    lines = [l.strip() for l in lines if l.strip() and len(l.strip()) > 1]
    
    if not lines:
        return None
    
    # 取最后一段有意义的内容作为最新消息
    # 跳过常见的 OCR 噪音
    skip_patterns = ['微信', 'WeChat', '发送', '表情', '文件', '语音', '视频通话',
                     '消息', '输入', '关闭', '最小化', '全屏', '更多']
    
    # 从后往前找第一条有效消息
    for line in reversed(lines):
        if len(line) >= 2 and not any(s in line for s in skip_patterns):
            # 也跳过长串英文（可能是 OCR 产生的时间戳噪音）
            if len(re.findall(r'[a-zA-Z]', line)) < len(line) * 0.3:
                return line
    
    return None

def ai_reply(message, user_id="wx_customer"):
    """调用 DeepSeek 生成回复"""
    try:
        r = requests.post(CS_API, json={
            "message": message,
            "user_id": user_id,
            "platform": "wechat_auto"
        }, timeout=20)
        data = r.json()
        return data.get("reply", "") if data.get("success") else ""
    except Exception as e:
        print(f"  ⚠️ AI error: {e}")
        return ""

def send_reply(text):
    """通过 AppleScript 在微信中粘贴并发送回复"""
    # 写入剪贴板
    pb = NSPasteboard.generalPasteboard()
    pb.clearContents()
    pb.setString_forType_(text, NSPasteboardTypeString)
    time.sleep(0.1)
    
    script = '''
    tell application "WeChat" to activate
    delay 0.3
    tell application "System Events"
        tell process "WeChat"
            set frontmost to true
            delay 0.2
            keystroke "v" using command down
            delay 0.3
            keystroke return
        end tell
    end tell
    '''
    try:
        subprocess.run(["osascript", "-e", script], timeout=5, capture_output=True)
        return True
    except Exception as e:
        print(f"  ⚠️ Send error: {e}")
        return False

def main():
    print("🤖 微信全自动智能客服 v3.0 启动")
    print("   原理: 截图OCR → 检测新消息 → DeepSeek → 自动回复")
    print("   前提: 电脑登录微信, 打开客服对话窗口")
    print("   Ctrl+C 停止\n")
    
    last_hash = ""
    fail_count = 0
    max_fails = 10
    
    while True:
        try:
            # 1. 截图
            img = capture_chat()
            if not img:
                fail_count += 1
                if fail_count > max_fails:
                    print("❌ 连续截图失败, 请确认微信窗口已打开")
                    time.sleep(10)
                    fail_count = 0
                time.sleep(POLL_INTERVAL)
                continue
            
            # 2. OCR
            text = ocr_text(img)
            if not text:
                time.sleep(POLL_INTERVAL)
                continue
            
            # 3. 检测变化
            h = hashlib.md5(text.encode()).hexdigest()
            if h == last_hash:
                time.sleep(POLL_INTERVAL)
                continue
            
            last_hash = h
            
            # 4. 提取消息
            msg = parse_last_message(text)
            if not msg:
                time.sleep(POLL_INTERVAL)
                continue
            
            # 过滤: 太短的消息可能是噪音
            if len(msg) < 2:
                continue
            
            print(f"\n📩 检测到消息: {msg[:80]}")
            
            # 5. AI 回复
            reply = ai_reply(msg)
            if reply:
                print(f"🤖 → {reply[:80]}")
                ok = send_reply(reply)
                print(f"   {'✅ 已发送' if ok else '❌ 发送失败'}")
                # 发送后冷却一下，避免连续回复
                time.sleep(2)
            else:
                print(f"   ⚠️ AI 无回复")
            
            fail_count = 0
            
        except KeyboardInterrupt:
            print("\n👋 已停止")
            break
        except Exception as e:
            fail_count += 1
            print(f"⚠️ {e}")
            if fail_count > max_fails:
                print("❌ 连续错误过多, 休眠 30 秒后重试...")
                time.sleep(30)
                fail_count = 0
            time.sleep(1)

if __name__ == "__main__":
    main()

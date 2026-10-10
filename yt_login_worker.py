import sys
import os
import time
import json

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(CURRENT_DIR, "login_state.json")
AUTH_FILE = os.path.join(CURRENT_DIR, "headers_auth.json")

def write_state(status, message, error=None):
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "status": status,
                "message": message,
                "error": error,
                "updated_at": time.time()
            }, f, indent=2)
    except Exception as e:
        print(f"Error writing state: {e}", file=sys.stderr)

def main():
    write_state("in_progress", "Launching secure sign-in window...")
    playwright_instance = None
    browser = None
    try:
        from playwright.sync_api import sync_playwright
        playwright_instance = sync_playwright().start()

        # Try msedge first (native on Windows), then chrome, then bundled chromium
        for channel in ["msedge", "chrome", None]:
            try:
                launch_kwargs = {
                    "headless": False,
                    "args": [
                        "--disable-blink-features=AutomationControlled",
                        "--no-default-browser-check",
                        "--window-size=500,720"
                    ],
                    "ignore_default_args": ["--enable-automation"]
                }
                if channel:
                    launch_kwargs["channel"] = channel
                browser = playwright_instance.chromium.launch(**launch_kwargs)
                break
            except Exception as b_err:
                print(f"Failed to launch with channel {channel}: {b_err}", file=sys.stderr)
                continue

        if not browser:
            write_state("error", "Could not launch desktop browser.", "Please ensure Microsoft Edge or Google Chrome is installed.")
            return

        context = browser.new_context(
            viewport={"width": 480, "height": 700},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = context.new_page()
        page.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

        login_url = "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com"
        page.goto(login_url)

        write_state("in_progress", "Official Google sign-in window is open. Sign in to your account — it will auto-close when done!")

        start_time = time.time()
        authenticated = False
        captured_cookies = []

        while time.time() - start_time < 300:
            time.sleep(1.0)
            if page.is_closed() or not browser.is_connected():
                if not authenticated:
                    write_state("cancelled", "Login window was closed.")
                return

            try:
                current_url = page.url
            except Exception:
                break

            cookies = context.cookies()
            has_sapisid = any(c.get("name") in ["SAPISID", "__Secure-3PAPISID"] for c in cookies)

            if ("music.youtube.com" in current_url or "youtube.com" in current_url) and has_sapisid:
                authenticated = True
                captured_cookies = cookies
                break

        if not authenticated:
            write_state("error", "Login timed out or credentials not detected.", "Timeout")
            return

        # Build cookie string
        cookie_parts = []
        for c in captured_cookies:
            if c.get("name") and c.get("value"):
                cookie_parts.append(f"{c['name']}={c['value']}")
        cookie_str = "; ".join(cookie_parts)

        headers_dict = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "*/*",
            "Accept-Encoding": "gzip, deflate",
            "Content-Type": "application/json",
            "Origin": "https://music.youtube.com",
            "Cookie": cookie_str,
            "Authorization": "SAPISIDHASH dummy_value",
            "x-goog-authuser": "0"
        }
        with open(AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump(headers_dict, f, indent=4)

        write_state("success", "Sign-in successful! Importing your library and playlists...")

    except Exception as e:
        print(f"Exception during login: {e}", file=sys.stderr)
        write_state("error", f"Login error: {str(e)}", str(e))
    finally:
        try:
            if browser:
                browser.close()
        except Exception:
            pass
        try:
            if playwright_instance:
                playwright_instance.stop()
        except Exception:
            pass

if __name__ == "__main__":
    main()

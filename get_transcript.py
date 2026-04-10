import sys
import json
import os
import re
import warnings
warnings.filterwarnings("ignore")

def get_transcript():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No Video ID provided"}))
        return

    video_id = sys.argv[1]
    cookies_path = sys.argv[2] if len(sys.argv) > 2 else None
    proxy_url = os.environ.get("PROXY_URL", "")

    if not (cookies_path and os.path.exists(cookies_path) and os.path.getsize(cookies_path) > 100):
        cookies_path = None

    # Method 1: youtube-transcript-api with proxy (fastest)
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        from youtube_transcript_api.proxies import WebshareProxyConfig

        if proxy_url:
            # Parse proxy url: http://user:pass@host:port
            api = YouTubeTranscriptApi(
                proxy_config=WebshareProxyConfig(
                    proxy_username=proxy_url.split("://")[1].split(":")[0],
                    proxy_password=proxy_url.split("://")[1].split(":")[1].split("@")[0],
                )
            )
        else:
            api = YouTubeTranscriptApi()

        try:
            transcript = api.fetch(video_id, languages=['en','en-US','en-GB','en-IN'])
        except Exception:
            transcript_list = api.list(video_id)
            transcript = None
            for t in transcript_list:
                transcript = t.fetch()
                break

        if transcript:
            result = [{'text': s.text, 'start': s.start, 'duration': s.duration} for s in transcript]
            print(json.dumps(result))
            return
    except Exception as e:
        print(f"Method 1 failed: {e}", file=sys.stderr)

    # Method 2: yt-dlp with proxy
    try:
        import yt_dlp
        import tempfile

        url = f"https://www.youtube.com/watch?v={video_id}"

        with tempfile.TemporaryDirectory() as tmpdir:
            ydl_opts = {
                'skip_download': True,
                'writesubtitles': True,
                'writeautomaticsub': True,
                'subtitleslangs': ['en', 'en-orig', 'en-US'],
                'subtitlesformat': 'vtt',
                'outtmpl': os.path.join(tmpdir, '%(id)s.%(ext)s'),
                'quiet': True,
                'no_warnings': True,
                'socket_timeout': 30,
            }
            if proxy_url:
                ydl_opts['proxy'] = proxy_url
                print(f"Using proxy", file=sys.stderr)
            if cookies_path:
                ydl_opts['cookiefile'] = cookies_path

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.extract_info(url, download=True)

            sub_file = None
            for fname in os.listdir(tmpdir):
                if fname.endswith('.vtt'):
                    sub_file = os.path.join(tmpdir, fname)
                    break

            if not sub_file:
                print(json.dumps({"error": "No captions found for this video"}))
                return

            with open(sub_file, 'r', encoding='utf-8') as f:
                content = f.read()

            transcript_data = []
            seen_texts = set()
            for block in content.strip().split('\n\n'):
                lines = block.strip().split('\n')
                time_line = next((l for l in lines if '-->' in l), None)
                if not time_line:
                    continue
                try:
                    start_str = time_line.split('-->')[0].strip()
                    parts = start_str.replace(',', '.').split(':')
                    start = float(parts[0])*3600 + float(parts[1])*60 + float(parts[2]) if len(parts)==3 else float(parts[0])*60 + float(parts[1])
                except:
                    continue
                text_lines = [re.sub(r'<[^>]+>', '', l).strip() for l in lines if '-->' not in l and l.strip()]
                text = ' '.join(text_lines).strip()
                if text and text not in seen_texts:
                    seen_texts.add(text)
                    transcript_data.append({'text': text, 'start': start, 'duration': 0})

        if transcript_data:
            print(json.dumps(transcript_data))
            return

    except Exception as e:
        print(f"Method 2 failed: {e}", file=sys.stderr)

    print(json.dumps({"error": "Could not fetch transcript. YouTube is blocking this server."}))

if __name__ == "__main__":
    get_transcript()
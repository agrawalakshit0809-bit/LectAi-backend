import sys
import json
import os
import warnings
warnings.filterwarnings("ignore")

def setup_cookies():
    cookies_content = os.environ.get("YOUTUBE_COOKIES", "")
    if cookies_content:
        cookies_path = "/tmp/yt_cookies.txt"
        with open(cookies_path, "w") as f:
            f.write(cookies_content)
        return cookies_path
    return None

def get_transcript():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No Video ID provided"}))
        return

    video_id = sys.argv[1]
    cookies_path = setup_cookies()

    try:
        from youtube_transcript_api import YouTubeTranscriptApi

        # Use cookies if available (bypasses cloud IP blocks)
        if cookies_path:
            api = YouTubeTranscriptApi(cookie_path=cookies_path)
        else:
            api = YouTubeTranscriptApi()

        try:
            transcript = api.fetch(video_id, languages=['en', 'en-US', 'en-GB', 'en-IN'])
        except Exception:
            try:
                transcript_list = api.list(video_id)
                transcript = None
                for t in transcript_list:
                    transcript = t.fetch()
                    break
            except Exception as e2:
                print(json.dumps({"error": f"No captions available: {str(e2)}"}))
                return

        if not transcript:
            print(json.dumps({"error": "No captions found"}))
            return

        result = [{'text': s.text, 'start': s.start, 'duration': s.duration} for s in transcript]
        print(json.dumps(result))

    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    get_transcript()
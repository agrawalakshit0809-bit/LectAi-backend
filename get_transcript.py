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
    api_key = os.environ.get("SUPADATA_API_KEY", "")

    # Method 1: Supadata API (never blocked, built for this)
    if api_key:
        try:
            import urllib.request
            url = f"https://api.supadata.ai/v1/youtube/transcript?videoId={video_id}&lang=en"
            req = urllib.request.Request(url, headers={"x-api-key": api_key})
            with urllib.request.urlopen(req, timeout=30) as response:
                data = json.loads(response.read().decode())
            
            if data.get("content"):
                result = [
                    {
                        'text': item.get('text', ''),
                        'start': item.get('offset', 0) / 1000,
                        'duration': item.get('duration', 0) / 1000
                    }
                    for item in data["content"]
                    if item.get('text', '').strip()
                ]
                if result:
                    print(json.dumps(result))
                    return
        except Exception as e:
            print(f"Supadata failed: {e}", file=sys.stderr)

    # Method 2: youtube-transcript-api (works without proxy sometimes)
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
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
        print(f"Method 2 failed: {e}", file=sys.stderr)

    print(json.dumps({"error": "Could not fetch transcript for this video."}))

if __name__ == "__main__":
    get_transcript()
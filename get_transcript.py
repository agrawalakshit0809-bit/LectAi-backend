import sys
import json
import warnings
warnings.filterwarnings("ignore")

def get_transcript():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No Video ID provided"}))
        return

    video_id = sys.argv[1]

    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        api = YouTubeTranscriptApi()  # ✅ 1.2.4 requires instance

        try:
            # Try English first
            transcript = api.fetch(video_id, languages=['en', 'en-US', 'en-GB', 'en-IN'])
        except Exception:
            try:
                # Try auto-generated in any language
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
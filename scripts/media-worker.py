"""Decode bounded QQ attachments locally; no remote media is opened here."""
import json
import os
from pathlib import Path
import site
import subprocess
import sys
import wave

ROOT = Path(__file__).resolve().parent.parent
site.addsitedir(str(ROOT / 'tools' / 'asr'))
os.environ['HF_HOME'] = str(ROOT / 'tools' / 'asr-models')
sys.stdout.reconfigure(encoding='utf-8')


def run():
    from faster_whisper import WhisperModel
    model_path = ROOT / 'tools' / 'asr-models' / 'tiny'
    if sys.argv[1] == '--setup':
        from huggingface_hub import snapshot_download
        snapshot_download('Systran/faster-whisper-tiny', local_dir=str(model_path), allow_patterns=['model.bin', 'config.json', 'tokenizer.json', 'vocabulary.*', 'preprocessor_config.json'])
        WhisperModel(str(model_path), device='cpu', compute_type='int8', cpu_threads=2)
        print('本地语音模型已安装并可加载。')
        return

    import imageio_ffmpeg
    path = Path(sys.argv[1]).resolve()
    folder = path.parent
    media_root = (ROOT / 'data' / 'message-media').resolve()
    if not path.is_relative_to(media_root):
        raise ValueError('Attachment is outside message temporary storage')
    with path.open('rb') as source:
        header = source.read(16)
    if not (header.startswith((b'ID3', b'OggS', b'fLaC', b'RIFF')) or header[4:8] == b'ftyp' or header.startswith(b'\x1aE\xdf\xa3') or len(header) > 1 and header[0] == 255 and header[1] & 224 == 224):
        raise ValueError('Unsupported media container')
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    command = [ffmpeg, '-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mp3,wav,mov,ogg,flac,aac,amr,matroska,webm,avi', '-i', str(path)]
    frames = []
    if len(sys.argv) > 2 and sys.argv[2] == 'video':
        subprocess.run(command + ['-an', '-vf', 'fps=1/5,scale=1280:-2', '-frames:v', '3', '-y', str(folder / 'video-%02d.png')], check=True, capture_output=True, timeout=45)
        frames = [str(p) for p in sorted(folder.glob('video-*.png'))[:3]]
    wav = folder / 'audio.wav'
    converted = subprocess.run(command + ['-vn', '-t', '180', '-ac', '1', '-ar', '16000', '-y', str(wav)], check=False, capture_output=True, timeout=45)
    text = ''
    if converted.returncode == 0 and wav.exists():
        import numpy as np
        model = WhisperModel(str(model_path), device='cpu', compute_type='int8', cpu_threads=2, local_files_only=True)
        with wave.open(str(wav), 'rb') as audio_file:
            audio = np.frombuffer(audio_file.readframes(180 * 16000), dtype=np.int16).astype(np.float32) / 32768.0
        parts, _ = model.transcribe(audio, beam_size=1, vad_filter=True, condition_on_previous_text=False)
        text = ''.join(part.text for part in parts)[:10000]
    print('BUPT_MEDIA_JSON:' + json.dumps({'text': text, 'frames': frames, 'note': '音轨最多识别前180秒；视频取前15秒内最多3帧。'}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        run()
    except Exception as error:
        print(json.dumps({'error': type(error).__name__}))
        sys.exit(1)

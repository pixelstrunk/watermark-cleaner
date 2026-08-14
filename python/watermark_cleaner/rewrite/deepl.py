import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from ..core import clean_text
from ..rules import load_rules

_FREE_HOST = "https://api-free.deepl.com"
_PRO_HOST = "https://api.deepl.com"


def _endpoint(api_key):
    host = _FREE_HOST if api_key.strip().endswith(":fx") else _PRO_HOST
    return f"{host}/v2/translate"


def _friendly_error(status):
    if status == 429:
        return "deepl rate limit reached, wait a moment and retry"
    if status == 456:
        return "deepl quota exceeded for this billing period"
    if status in (401, 403):
        return "deepl rejected the api key, check DEEPL_API_KEY"
    return f"deepl responded with http {status}"


def _translate(text, api_key, target_lang, source_lang=None):
    fields = {"text": text, "target_lang": target_lang}
    if source_lang:
        fields["source_lang"] = source_lang
    data = urllib.parse.urlencode(fields).encode("utf-8")
    request = urllib.request.Request(
        _endpoint(api_key),
        data=data,
        headers={
            "Authorization": f"DeepL-Auth-Key {api_key}",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "watermark-cleaner/0.2",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise RuntimeError(_friendly_error(error.code)) from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"could not reach deepl: {error.reason}") from error
    translation = payload["translations"][0]
    return translation["text"], translation.get("detected_source_language")


def back_translate(text, source_lang=None, pivot_lang="EN", api_key=None):
    api_key = api_key or os.environ.get("DEEPL_API_KEY")
    if not api_key:
        raise RuntimeError("set DEEPL_API_KEY to use the rewrite command")
    pivot_text, detected = _translate(text, api_key, target_lang=pivot_lang, source_lang=source_lang)
    back_target = source_lang or detected
    if not back_target:
        raise RuntimeError("could not detect the source language, pass --source-lang")
    if back_target.upper().startswith(pivot_lang.upper()):
        raise RuntimeError(
            f"text is already in the pivot language ({back_target}), pass a different --pivot-lang"
        )
    back, _ = _translate(pivot_text, api_key, target_lang=back_target, source_lang=pivot_lang)
    return back


def rewrite_file(path, target_lang=None, pivot_lang="EN", write=False, config=None):
    original = Path(path).read_text(encoding="utf-8")
    rewritten = back_translate(original, source_lang=target_lang, pivot_lang=pivot_lang)
    if config is not None:
        rewritten, _ = clean_text(rewritten, config=config, rules=load_rules(), path=str(path))
    if write:
        backup = Path(path).with_suffix(Path(path).suffix + ".bak")
        if not backup.exists():
            backup.write_bytes(Path(path).read_bytes())
        Path(path).write_text(rewritten, encoding="utf-8")
    return rewritten

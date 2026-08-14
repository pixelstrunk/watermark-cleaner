import os
import stat
import sys
import tempfile
from pathlib import Path

DEFAULT_MAX_FILE_BYTES = 256 * 1024 * 1024

_warned_bad_env = False


def _env_max_file_bytes():
    global _warned_bad_env
    env = os.environ.get("WATERMARK_CLEANER_MAX_FILE_BYTES")
    if not env:
        return None
    try:
        value = int(env)
        if value <= 0:
            raise ValueError
        return value
    except ValueError:
        if not _warned_bad_env:
            print(
                f"warning: ignoring WATERMARK_CLEANER_MAX_FILE_BYTES={env!r} (must be a positive integer)",
                file=sys.stderr,
            )
            _warned_bad_env = True
        return None


def max_file_bytes(config=None):
    if config and config.get("max_file_bytes"):
        return int(config["max_file_bytes"])
    env = _env_max_file_bytes()
    if env is not None:
        return env
    return DEFAULT_MAX_FILE_BYTES


def too_large(path, config=None):
    try:
        return Path(path).stat().st_size > max_file_bytes(config)
    except OSError:
        return False


def is_symlink(path):
    return Path(path).is_symlink()


def write_bytes_atomic(path, data):
    target = Path(path)
    if target.is_symlink():
        raise OSError(f"refusing to write through symlink: {target}")
    handle, temp_path = tempfile.mkstemp(prefix=target.name + ".", suffix=".watermark-cleaner-tmp", dir=str(target.parent))
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(data)
        try:
            mode = stat.S_IMODE(target.stat().st_mode)
            os.chmod(temp_path, mode)
        except OSError:
            pass
        os.replace(temp_path, target)
    except BaseException:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        raise


def write_text_atomic(path, text):
    write_bytes_atomic(path, text.encode("utf-8"))

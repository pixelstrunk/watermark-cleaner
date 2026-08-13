import os
import tempfile
from pathlib import Path

DEFAULT_MAX_FILE_BYTES = 256 * 1024 * 1024


def max_file_bytes(config=None):
    if config and config.get("max_file_bytes"):
        return int(config["max_file_bytes"])
    env = os.environ.get("WMC_MAX_FILE_BYTES")
    if env:
        return int(env)
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
    handle, temp_path = tempfile.mkstemp(prefix=target.name + ".", suffix=".wmc-tmp", dir=str(target.parent))
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(data)
        os.replace(temp_path, target)
    except BaseException:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        raise


def write_text_atomic(path, text):
    write_bytes_atomic(path, text.encode("utf-8"))

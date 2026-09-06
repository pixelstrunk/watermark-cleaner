import os
from pathlib import Path

from .core import clean_text
from .findings import Finding, Report
from .layers import metadata, office
from .rules import load_rules
from .safeio import is_symlink, too_large, write_text_atomic

_PERMISSION_MESSAGE = "skipped (permission denied)"
_IO_MESSAGE = "skipped (i/o error)"


def collect_files(paths, config):
    text_ext = {e.lower() for e in config["text_extensions"]}
    image_ext = {e.lower() for e in config["image_extensions"]}
    document_ext = {e.lower() for e in config.get("document_extensions", [])}
    exclude = set(config.get("exclude", []))
    text_files = []
    image_files = []
    document_files = []
    missing = []
    unreadable = []
    for raw in paths:
        base = Path(raw)
        try:
            is_file = base.is_file()
            is_dir = base.is_dir()
        except OSError:
            unreadable.append(base)
            continue
        if is_file:
            _classify(base, text_ext, image_ext, document_ext, text_files, image_files, document_files)
        elif is_dir:
            for item in _walk(base, exclude, unreadable):
                _classify(item, text_ext, image_ext, document_ext, text_files, image_files, document_files)
        else:
            missing.append(base)
    return _dedupe(text_files), _dedupe(image_files), _dedupe(document_files), missing, unreadable


def _walk(directory, exclude, unreadable):
    try:
        with os.scandir(directory) as entries:
            children = sorted(entries, key=lambda entry: entry.name)
    except OSError:
        unreadable.append(directory)
        return
    for entry in children:
        if entry.name in exclude:
            continue
        path = Path(entry.path)
        try:
            if entry.is_dir(follow_symlinks=False):
                yield from _walk(path, exclude, unreadable)
            elif entry.is_file():
                yield path
        except OSError:
            unreadable.append(path)


def _dedupe(files):
    seen = set()
    result = []
    for item in files:
        try:
            key = item.resolve()
        except OSError:
            key = item.absolute()
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def _classify(item, text_ext, image_ext, document_ext, text_files, image_files, document_files):
    suffix = item.suffix.lower()
    if suffix in text_ext:
        text_files.append(item)
    elif suffix in image_ext:
        image_files.append(item)
    elif suffix in document_ext:
        document_files.append(item)


def _skip_report(path, message):
    report = Report(path=str(path))
    report.findings.append(Finding("io", "read", "warn", message, 1))
    return report


def _safely(path, action):
    try:
        return action()
    except PermissionError:
        return _skip_report(path, _PERMISSION_MESSAGE)
    except OSError:
        return _skip_report(path, _IO_MESSAGE)


def process_text_file(path, config, rules, write):
    if too_large(path, config):
        return _skip_report(path, "skipped (larger than max_file_bytes)")
    raw = Path(path).read_bytes()
    try:
        original = raw.decode("utf-8")
    except UnicodeDecodeError:
        return _skip_report(path, "skipped (not utf-8 text)")

    cleaned, report = clean_text(original, config=config, rules=rules, path=str(path))
    if write and report.changed:
        if is_symlink(path):
            report.changed = False
            report.findings.append(Finding("io", "write", "warn", "refused to write through symlink", 1))
            return report
        if config.get("backup", True):
            _backup(path)
        write_text_atomic(path, cleaned)
    return report


def run(paths, config, write):
    rules = load_rules()
    text_files, image_files, document_files, missing, unreadable = collect_files(paths, config)
    reports = []
    for path in missing:
        reports.append(_skip_report(path, "path not found"))
    for path in unreadable:
        reports.append(_skip_report(path, _PERMISSION_MESSAGE))
    for path in text_files:
        reports.append(_safely(path, lambda: process_text_file(path, config, rules, write)))
    backup = config.get("backup", True)
    strip_icc = config.get("strip_icc", False)
    for path in image_files:
        if too_large(path, config):
            reports.append(_skip_report(path, "skipped (larger than max_file_bytes)"))
            continue
        if write:
            reports.append(_safely(path, lambda: metadata.clean_file(path, write=True, backup=backup, strip_icc=strip_icc)))
        else:
            reports.append(_safely(path, lambda: metadata.inspect_file(path, strip_icc=strip_icc)))
    for path in document_files:
        if too_large(path, config):
            reports.append(_skip_report(path, "skipped (larger than max_file_bytes)"))
            continue
        if write:
            reports.append(_safely(path, lambda: office.clean_file(path, write=True, backup=backup)))
        else:
            reports.append(_safely(path, lambda: office.inspect_file(path)))
    return reports


def _backup(path):
    p = Path(path)
    backup = p.with_suffix(p.suffix + ".bak")
    if not backup.exists():
        backup.write_bytes(p.read_bytes())

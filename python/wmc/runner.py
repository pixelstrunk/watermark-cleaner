from pathlib import Path

from .core import clean_text
from .findings import Finding, Report
from .layers import metadata
from .rules import load_rules
from .safeio import is_symlink, too_large, write_text_atomic


def collect_files(paths, config):
    text_ext = {e.lower() for e in config["text_extensions"]}
    image_ext = {e.lower() for e in config["image_extensions"]}
    exclude = set(config.get("exclude", []))
    text_files = []
    image_files = []
    missing = []
    for raw in paths:
        base = Path(raw)
        if not base.exists():
            missing.append(base)
            continue
        if base.is_file():
            _classify(base, text_ext, image_ext, text_files, image_files)
            continue
        for item in sorted(base.rglob("*")):
            if not item.is_file():
                continue
            if any(part in exclude for part in item.parts):
                continue
            _classify(item, text_ext, image_ext, text_files, image_files)
    return text_files, image_files, missing


def _classify(item, text_ext, image_ext, text_files, image_files):
    suffix = item.suffix.lower()
    if suffix in text_ext:
        text_files.append(item)
    elif suffix in image_ext:
        image_files.append(item)


def process_text_file(path, config, rules, write):
    report = Report(path=str(path))
    if too_large(path, config):
        report.findings.append(Finding("io", "read", "warn", "skipped (larger than max_file_bytes)", 1))
        return report
    try:
        original = Path(path).read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        report.findings.append(Finding("io", "read", "warn", "skipped (not utf-8 text)", 1))
        return report

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
    text_files, image_files, missing = collect_files(paths, config)
    reports = []
    for path in missing:
        report = Report(path=str(path))
        report.findings.append(Finding("io", "read", "warn", "path not found", 1))
        reports.append(report)
    for path in text_files:
        reports.append(process_text_file(path, config, rules, write))
    backup = config.get("backup", True)
    strip_icc = config.get("strip_icc", False)
    for path in image_files:
        if too_large(path, config):
            report = Report(path=str(path))
            report.findings.append(Finding("io", "read", "warn", "skipped (larger than max_file_bytes)", 1))
            reports.append(report)
            continue
        if write:
            reports.append(metadata.clean_file(path, write=True, backup=backup, strip_icc=strip_icc))
        else:
            reports.append(metadata.inspect_file(path, strip_icc=strip_icc))
    return reports


def _backup(path):
    p = Path(path)
    backup = p.with_suffix(p.suffix + ".bak")
    if not backup.exists():
        backup.write_bytes(p.read_bytes())

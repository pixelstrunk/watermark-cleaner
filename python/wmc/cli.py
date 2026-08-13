import argparse
import json
import sys

from . import __version__
from .config import apply_aggressive, load_config
from .report import render_report, render_summary
from .runner import run


def build_parser():
    parser = argparse.ArgumentParser(
        prog="wmc",
        description="WMC Cleaner: remove ai text artifacts, ai phrases and file metadata.",
    )
    parser.add_argument("--version", action="version", version=f"wmc {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    for name in ("check", "fix"):
        p = sub.add_parser(name, help=f"{name} files or folders")
        p.add_argument("paths", nargs="*", default=["."], help="files or folders (default: .)")
        p.add_argument("--config", help="path to a wmc config file")
        p.add_argument("--json", action="store_true", help="emit json report")
        p.add_argument("--no-voice", action="store_true", help="disable the voice/ai-phrase layer")
        p.add_argument("--aggressive", action="store_true", help="also replace homoglyphs and strip variation selectors")
        p.add_argument("--no-backup", action="store_true", help="do not write .bak backups (use inside git hooks)")
        p.add_argument("--quiet", action="store_true", help="only print the summary line")
        p.add_argument("--strict", action="store_true", help="fix only: exit non-zero when blocking findings remain")

    rewrite = sub.add_parser("rewrite", help="optional deepl rewrite (opt-in, sends text to deepl)")
    rewrite.add_argument("paths", nargs="+", help="text files to rewrite")
    rewrite.add_argument("--source-lang", default=None, help="document language (default: auto-detect via deepl)")
    rewrite.add_argument("--pivot-lang", default="EN", help="intermediate language for back-translation (default EN)")
    rewrite.add_argument("--write", action="store_true", help="write result back (default prints)")
    rewrite.add_argument("--config", help="path to a wmc config file")
    return parser


def _resolve_config(args):
    start = args.paths[0] if getattr(args, "paths", None) else "."
    config = load_config(getattr(args, "config", None), start)
    if getattr(args, "no_voice", False):
        config["voice"] = False
    if getattr(args, "aggressive", False):
        config = apply_aggressive(config)
    if getattr(args, "no_backup", False):
        config["backup"] = False
    return config


def _run_scan(args, write):
    config = _resolve_config(args)
    paths = args.paths or ["."]
    reports = run(paths, config, write=write)

    if args.json:
        payload = {
            "mode": "fix" if write else "check",
            "summary": render_summary(reports),
            "reports": [r.to_dict() for r in reports],
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        if not args.quiet:
            for report in reports:
                if report.findings:
                    print(render_report(report))
        print()
        print(render_summary(reports))

    blocking = any(r.has_blocking for r in reports)
    if blocking and (not write or getattr(args, "strict", False)):
        return 1
    return 0


def _run_rewrite(args):
    from .rewrite.deepl import rewrite_file

    config = load_config(getattr(args, "config", None), args.paths[0])
    code = 0
    for path in args.paths:
        try:
            result = rewrite_file(path, target_lang=args.source_lang, pivot_lang=args.pivot_lang, write=args.write, config=config)
            if args.write:
                print(f"rewritten  {path}")
            else:
                print(result)
        except Exception as error:
            print(f"error  {path}: {error}", file=sys.stderr)
            code = 1
    return code


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "check":
        return _run_scan(args, write=False)
    if args.command == "fix":
        return _run_scan(args, write=True)
    if args.command == "rewrite":
        return _run_rewrite(args)
    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())

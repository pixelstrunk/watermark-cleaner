from dataclasses import dataclass, field
from typing import List

SEVERITY_ORDER = {"fixed": 0, "info": 1, "warn": 2, "error": 3}


@dataclass
class Finding:
    layer: str
    kind: str
    severity: str
    message: str
    count: int = 1
    examples: List[str] = field(default_factory=list)

    def to_dict(self):
        return {
            "layer": self.layer,
            "kind": self.kind,
            "severity": self.severity,
            "message": self.message,
            "count": self.count,
            "examples": self.examples,
        }


@dataclass
class Report:
    path: str
    findings: List[Finding] = field(default_factory=list)
    original_length: int = 0
    cleaned_length: int = 0
    changed: bool = False

    @property
    def has_errors(self):
        return any(f.severity == "error" for f in self.findings)

    @property
    def has_blocking(self):
        return self.has_errors

    def counts(self):
        result = {"fixed": 0, "warn": 0, "error": 0, "info": 0}
        for f in self.findings:
            result[f.severity] = result.get(f.severity, 0) + f.count
        return result

    def to_dict(self):
        return {
            "path": self.path,
            "changed": self.changed,
            "original_length": self.original_length,
            "cleaned_length": self.cleaned_length,
            "counts": self.counts(),
            "findings": [f.to_dict() for f in self.findings],
        }

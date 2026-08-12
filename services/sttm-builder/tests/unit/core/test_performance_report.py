import importlib.util
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[5] / "scripts" / "report_workbench_performance.py"
SPEC = importlib.util.spec_from_file_location("report_workbench_performance", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


def test_compare_reports_calculates_rolling_p95_change() -> None:
    baseline = {
        "latency_by_workload": [
            {"WORKLOAD": "preparation", "P95_TOTAL_MS": 10000}
        ]
    }
    current = {
        "latency_by_workload": [
            {"WORKLOAD": "preparation", "P95_TOTAL_MS": 6500}
        ]
    }

    result = MODULE.compare_reports(current, baseline)

    assert result["latency"][0]["p95_change_percent"] == -35.0

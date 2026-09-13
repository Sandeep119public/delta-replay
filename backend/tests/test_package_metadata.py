import tomllib
from pathlib import Path


BACKEND = Path(__file__).resolve().parents[1]


def test_package_version_matches_application_version():
    project = tomllib.loads((BACKEND / "pyproject.toml").read_text())
    main = (BACKEND / "app" / "main.py").read_text()

    package_version = project["project"]["version"]
    marker = 'version="'
    start = main.index(marker) + len(marker)
    application_version = main[start : main.index('"', start)]

    assert application_version == package_version

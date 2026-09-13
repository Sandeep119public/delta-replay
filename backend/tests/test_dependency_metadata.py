import tomllib
from pathlib import Path

from packaging.requirements import Requirement


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"


def parse(requirement):
    parsed = Requirement(requirement)
    return parsed.name.lower(), str(parsed.specifier)


def test_requirements_and_project_metadata_describe_the_same_runtime_dependencies():
    project = tomllib.loads((BACKEND / "pyproject.toml").read_text())
    project_requirements = {parse(value) for value in project["project"]["dependencies"]}
    requirement_lines = {
        parse(line.strip())
        for line in (BACKEND / "requirements.txt").read_text().splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }
    project_plus_test = project_requirements | {
        parse(value) for value in project["project"]["optional-dependencies"]["test"]
    }
    assert requirement_lines == project_plus_test


def test_project_metadata_declares_every_direct_runtime_package():
    project = tomllib.loads((BACKEND / "pyproject.toml").read_text())
    declared = {Requirement(value).name.lower() for value in project["project"]["dependencies"]}
    assert {
        "fastapi",
        "uvicorn",
        "pydantic",
        "httpx",
        "python-multipart",
        "psycopg",
    } <= declared


def test_dependency_metadata_keeps_test_only_packages_out_of_runtime():
    project = tomllib.loads((BACKEND / "pyproject.toml").read_text())
    runtime = {Requirement(value).name.lower() for value in project["project"]["dependencies"]}
    test_only = {Requirement(value).name.lower() for value in project["project"]["optional-dependencies"]["test"]}
    assert runtime.isdisjoint(test_only)

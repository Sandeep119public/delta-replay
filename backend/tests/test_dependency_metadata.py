import tomllib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"


def normalize(requirement):
    return requirement.strip().lower()


def test_requirements_and_project_metadata_describe_the_same_dependencies():
    project = tomllib.loads((BACKEND / "pyproject.toml").read_text())
    project_requirements = {
        normalize(value) for value in project["project"]["dependencies"]
    }
    project_requirements |= {
        normalize(value)
        for value in project["project"]["optional-dependencies"]["test"]
    }
    requirement_lines = {
        normalize(line)
        for line in (BACKEND / "requirements.txt").read_text().splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }
    assert requirement_lines == project_requirements


def test_project_metadata_declares_every_direct_runtime_package():
    project = tomllib.loads((BACKEND / "pyproject.toml").read_text())
    names = {
        value.split("[", 1)[0].split("<", 1)[0].split(">", 1)[0].split("=", 1)[0].strip().lower()
        for value in project["project"]["dependencies"]
    }
    assert {
        "fastapi",
        "uvicorn",
        "pydantic",
        "httpx",
        "python-multipart",
        "psycopg",
    } <= names


def test_dependency_metadata_keeps_test_only_packages_out_of_runtime():
    project = tomllib.loads((BACKEND / "pyproject.toml").read_text())
    runtime = set(project["project"]["dependencies"])
    test_only = set(project["project"]["optional-dependencies"]["test"])
    assert runtime.isdisjoint(test_only)

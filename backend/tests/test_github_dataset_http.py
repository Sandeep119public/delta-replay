import httpx

from app.services.github_dataset_repository import GitHubDatasetRepository


def test_contents_reads_include_configured_branch_and_do_not_duplicate_headers(monkeypatch):
    calls = []

    class FakeResponse:
        status_code = 200
        content = b'{}'

        def raise_for_status(self):
            return None

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def request(self, method, url, headers=None, **kwargs):
            calls.append((method, url, headers, kwargs))
            return FakeResponse()

    monkeypatch.setattr(httpx, "Client", FakeClient)
    repo = GitHubDatasetRepository(repo="owner/repo", branch="datasets", token="secret")

    assert repo._get_raw("datasets/manifest.json") == b"{}"
    assert len(calls) == 1
    method, url, headers, kwargs = calls[0]
    assert method == "GET"
    assert url.endswith("/contents/datasets/manifest.json?ref=datasets")
    assert headers["Authorization"] == "Bearer secret"
    assert headers["Accept"] == "application/vnd.github.raw+json"
    assert "headers" not in kwargs


def test_branch_name_is_url_encoded(monkeypatch):
    calls = []

    class FakeResponse:
        status_code = 200
        content = b"{}"

        def raise_for_status(self):
            return None

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def request(self, method, url, headers=None, **kwargs):
            calls.append(url)
            return FakeResponse()

    monkeypatch.setattr(httpx, "Client", FakeClient)
    repo = GitHubDatasetRepository(repo="owner/repo", branch="data/2026", token="secret")
    repo._get_raw("manifest.json")
    assert calls[0].endswith("/contents/manifest.json?ref=data%2F2026")

import hashlib
import json
import os


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)


def fingerprint(*, dataset_content_id, feature_version="unknown", model_version="unknown",
                code_commit=None, configuration=None, seed=None):
    """Stable experiment identity independent of dictionary key ordering."""
    commit = code_commit or os.getenv("APP_GIT_COMMIT", "unknown")
    payload = {
        "datasetContentId": str(dataset_content_id),
        "featureVersion": str(feature_version),
        "modelVersion": str(model_version),
        "codeCommit": str(commit),
        "configuration": configuration or {},
        "seed": seed,
    }
    digest = hashlib.sha256(_canonical(payload).encode("utf-8")).hexdigest()
    return {"fingerprint": digest, **payload}

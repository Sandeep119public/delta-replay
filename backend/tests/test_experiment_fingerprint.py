from app.services.experiment_fingerprint import fingerprint


def test_fingerprint_is_stable_for_configuration_order():
    left = fingerprint(
        dataset_content_id="abc",
        feature_version="v1",
        model_version="teacher-v1",
        code_commit="123",
        configuration={"b": 2, "a": 1},
        seed=42,
    )
    right = fingerprint(
        dataset_content_id="abc",
        feature_version="v1",
        model_version="teacher-v1",
        code_commit="123",
        configuration={"a": 1, "b": 2},
        seed=42,
    )
    assert left["fingerprint"] == right["fingerprint"]


def test_fingerprint_changes_when_dataset_changes():
    a = fingerprint(dataset_content_id="abc", code_commit="123")
    b = fingerprint(dataset_content_id="def", code_commit="123")
    assert a["fingerprint"] != b["fingerprint"]

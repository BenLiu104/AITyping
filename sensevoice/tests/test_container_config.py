"""Static config contract tests for the SenseVoice container POC.

Dependency-light (stdlib only, no docker / no pyyaml): parses the committed
Dockerfile, docker-compose.yml and .dockerignore as text and
asserts the invariants the POC review requires. These are committed, meaningful
checks — not a transient /tmp self-report — so a future edit that breaks the
build-cache layering, un-pins a model, or drops the sensevoice-local profile
gating fails CI here instead of silently at build time.

Run:
    cd sensevoice
    PYTHONPATH=. ./venv/bin/python -m unittest tests.test_container_config -v
"""
from __future__ import annotations

import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SENSEVOICE_DIR = os.path.dirname(HERE)
REPO_ROOT = os.path.dirname(SENSEVOICE_DIR)

DOCKERFILE = os.path.join(SENSEVOICE_DIR, "Dockerfile")
DOCKERIGNORE = os.path.join(SENSEVOICE_DIR, ".dockerignore")
COMPOSE = os.path.join(REPO_ROOT, "docker-compose.yml")



def read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def copy_line_index(dockerfile: str, needle: str) -> int:
    """Return the line index of the first `COPY ... <needle> ...` instruction."""
    for i, line in enumerate(dockerfile.splitlines()):
        stripped = line.strip()
        if stripped.startswith("COPY") and needle in stripped:
            return i
    raise AssertionError(f"no COPY line containing {needle!r}")


def run_line_index(dockerfile: str, needle: str) -> int:
    for i, line in enumerate(dockerfile.splitlines()):
        stripped = line.strip()
        if stripped.startswith("RUN") and needle in stripped:
            return i
    raise AssertionError(f"no RUN line containing {needle!r}")


class DockerfileCacheLayeringTests(unittest.TestCase):
    def setUp(self) -> None:
        self.df = read(DOCKERFILE)

    def test_api_and_tests_copied_after_streaming_model_layer(self) -> None:
        # api.py / tests must come after the ONNX fetch layer so source edits do
        # not re-download the pinned streaming models.
        api_copy = copy_line_index(self.df, "api.py")
        tests_copy = copy_line_index(self.df, "tests/")
        fetch_run = run_line_index(self.df, "fetch_models.py")
        self.assertLess(fetch_run, api_copy)
        self.assertLess(fetch_run, tests_copy)

    def test_model_prep_inputs_copied_before_model_layers(self) -> None:
        prep_copy = copy_line_index(self.df, "fetch_models.py")
        fetch_run = run_line_index(self.df, "fetch_models.py")
        self.assertLess(
            prep_copy, fetch_run,
            "fetch_models.py + manifests must be COPYed before the fetch RUN",
        )

    def test_no_separate_unpinned_modelscope_pip_install(self) -> None:
        # modelscope must be pinned in requirements.txt, not a bare pip install.
        self.assertNotRegex(
            self.df, r"pip install[^\n]*\bmodelscope\b(?![=<>])",
            "Dockerfile must not `pip install modelscope` unpinned; pin it in requirements.txt",
        )

    def test_streaming_model_integrity_verify_layer_present(self) -> None:
        self.assertIn("sha256sum -c /home/user/app/models.sha256", self.df)


class ComposeProfileContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.compose = read(COMPOSE)

    def test_sensevoice_gated_behind_profile(self) -> None:
        # sensevoice service must be opt-in via the sensevoice-local profile so a
        # bare `docker compose up` never starts the POC alongside production.
        self.assertRegex(self.compose, r"profiles:\s*\n\s*-\s*sensevoice-local")

    def test_sensevoice_has_no_restart_policy(self) -> None:
        # POC must not carry a production restart policy.
        block = self.compose[self.compose.index("sensevoice:"):]
        self.assertNotIn("restart:", block, "POC sensevoice service must not set a restart policy")

    def test_host_port_is_configurable_with_7860_container_port(self) -> None:
        block = self.compose[self.compose.index("sensevoice:"):]
        self.assertIn('"${SENSEVOICE_HOST_PORT:-7860}:7860"', block)

    def test_sensevoice_receives_only_shared_ws_secret(self) -> None:
        block = self.compose[self.compose.index("sensevoice:"):]
        self.assertIn("SENSEVOICE_WS_TOKEN_SECRET", block)
        self.assertNotIn("env_file:", block)


class StreamingModelContractTests(unittest.TestCase):
    def test_dockerignore_excludes_loose_model_blobs(self) -> None:
        di = read(DOCKERIGNORE)
        for pat in ("*.onnx", "*.pt", "hub/", "*.mvn"):
            self.assertIn(pat, di, f".dockerignore must exclude loose model blobs: {pat}")


if __name__ == "__main__":
    unittest.main()

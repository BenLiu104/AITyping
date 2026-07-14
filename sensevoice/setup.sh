#!/usr/bin/env bash
# SenseVoice STT API — reproducible setup
#
# 喺 repo 內建立 venv 並安裝所有依賴。可重複執行（idempotent）。
# 用法：
#   cd sensevoice && ./setup.sh
#   ./setup.sh --recreate     # 刪掉舊 venv 重建
#
# 前提：系統有 python3.11（VPS ARM64 / 任何 Linux）。
# 注意：venv 一定要「就地」建立——venv 不可搬移（bin/ 內 script 的 shebang 寫死絕對路徑）。
#       若要換路徑，喺新路徑重跑呢個 script，唔好 mv。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV_DIR="$SCRIPT_DIR/venv"
PYTHON_BIN="${PYTHON_BIN:-python3.11}"


if [[ "${1:-}" == "--recreate" ]]; then
  echo "==> Removing existing venv ($VENV_DIR)"
  rm -rf "$VENV_DIR"
fi

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "ERROR: $PYTHON_BIN not found. Install Python 3.11 first." >&2
  exit 1
fi

if [[ ! -d "$VENV_DIR" ]]; then
  echo "==> Creating venv at $VENV_DIR (in place — do not move it later)"
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

# 一律用 venv 內的 python 執行 pip，避免 shebang / PATH 歧義。
VPY="$VENV_DIR/bin/python"

echo "==> Upgrading pip"
"$VPY" -m pip install --upgrade pip >/dev/null

echo "==> Installing requirements"
"$VPY" -m pip install -r "$SCRIPT_DIR/requirements.txt"

echo "==> Verifying key imports"
"$VPY" - <<'PYEOF'
import importlib, sys
mods = ["flask", "flask_sock", "flask_cors", "soundfile", "numpy", "opencc",
        "sense_voice_streaming_asr"]
missing = []
for m in mods:
    try:
        importlib.import_module(m)
    except Exception as e:
        missing.append(f"{m}: {e}")
if missing:
    print("IMPORT FAILURES:", *missing, sep="\n  ", file=sys.stderr)
    sys.exit(1)
print("All key imports OK")
PYEOF

echo "==> Verifying bundled ONNX models (guards against Git LFS pointer files)"
# sense-voice-streaming-asr 的模型係 ModelScope git submodule；pip-from-git 唔會
# init submodule，所以 model_quant.onnx 可能係指標檔而唔係真權重 → onnxruntime InvalidProtobuf。
# 對照 models.sha256 核對；唔啱就由 ModelScope 官方 repo（iic/*，pinned revision）下載真模型。
MODELS_DIR="$("$VPY" -c 'import sense_voice_streaming_asr, os; print(os.path.join(os.path.dirname(sense_voice_streaming_asr.__file__), "models"))')"
if ! ( cd "$MODELS_DIR" && sha256sum -c "$SCRIPT_DIR/models.sha256" --quiet ) 2>/dev/null; then
  echo "    models missing/corrupt — fetching from ModelScope (canonical iic/* upstream)"
  "$VPY" "$SCRIPT_DIR/fetch_models.py" --models-dir "$MODELS_DIR"
fi

echo "==> Verifying model checksums"
if ! ( cd "$MODELS_DIR" && sha256sum -c "$SCRIPT_DIR/models.sha256" ); then
  echo "" >&2
  echo "ERROR: model checksums still mismatch after fetch." >&2
  echo "       檢查網絡 / ModelScope 可達性，或見 sensevoice/DEPLOY.md「模型下載」一節手動放置：" >&2
  echo "         $MODELS_DIR" >&2
  exit 1
fi
echo "All model checksums OK"

echo ""
echo "==> Done. Run the API with:"
echo "    $VENV_DIR/bin/python $SCRIPT_DIR/api.py --preload --port 8082"
echo ""
echo "    Note: streaming ONNX models are vendored into the venv by this script."

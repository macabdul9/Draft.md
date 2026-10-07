# Source this file explicitly to enable the optional two-word launch forms.
# Function bodies run in subshells so strict mode never changes the calling shell.
start() {
  (
  set -euo pipefail
  if [[ "${1:-}" == 'draft.md' || "${1:-}" == 'dmd' ]]; then
    shift
    command draft.md start "$@"
  else
    command start "$@"
  fi
  )
}
run() {
  (
  set -euo pipefail
  if [[ "${1:-}" == 'draft.md' || "${1:-}" == 'dmd' ]]; then
    shift
    command draft.md run "$@"
  else
    command run "$@"
  fi
  )
}

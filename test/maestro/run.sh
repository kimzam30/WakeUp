#!/bin/bash
# run.sh <serial> <flow...>: runs Maestro flows with analytics off; screenshots land in ~/.maestro/tests/<run>/
export MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true PATH=$PATH:$HOME/.maestro/maestro/bin:$HOME/Android/Sdk/platform-tools
cd "$(dirname "$0")"; d=$1; shift
maestro --device "$d" test "$@" 2>&1 | grep -E "COMPLETED|FAILED|false|Flow|Passed|Failed" | grep -v SKIPPED

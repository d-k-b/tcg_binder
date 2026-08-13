#!/bin/zsh
set -eu

script_dir=${0:A:h}
node "$script_dir/run_local_price_monitor.mjs"

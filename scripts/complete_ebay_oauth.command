#!/bin/zsh
set -eu

script_dir=${0:A:h}
node "$script_dir/complete_ebay_oauth.mjs"

print
read -k 1 "?Press any key to close this window."
print

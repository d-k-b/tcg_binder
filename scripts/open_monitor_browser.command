#!/bin/zsh
set -eu

monitor_profile_dir="/Users/dkb/.config/tcg-price-monitor/browser-profiles/marketplaces"
chrome_binary="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if [[ ! -x "$chrome_binary" ]]; then
  print -u2 "Google Chrome was not found at: $chrome_binary"
  exit 1
fi

mkdir -p "$monitor_profile_dir"
chmod 700 "$monitor_profile_dir"

# A separate Chrome process is required so this private user-data directory does
# not merge with the user's everyday Chrome session. DevTools is loopback-only
# for the local monitor's read/watch automation.
open -na "Google Chrome" --args \
  --user-data-dir="$monitor_profile_dir" \
  --profile-directory=Default \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9333 \
  --no-first-run \
  --no-default-browser-check \
  "https://comics.ha.com/c/login.zx" \
  "https://www.tcgplayer.com/login"

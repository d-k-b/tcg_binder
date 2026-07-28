#!/bin/bash
# Double-click this file to open the binder properly.
#
# Why this exists: opening mtg_binder_app.html straight from Finder gives the page
# a file:// address, and Chrome does not give file:// pages persistent storage.
# Your GitHub token and your checkmarks get dropped on every refresh. Serving the
# same folder over http gives the page a real origin, and everything sticks.
#
# Nothing leaves your machine — this only listens on localhost.

cd "$(dirname "$0")" || exit 1
PORT=8765

# If the port is taken, walk forward until we find a free one.
while lsof -i ":$PORT" >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

URL="http://localhost:$PORT/mtg_binder_app.html"

echo "Serving $(pwd)"
echo "Binder:  $URL"
echo
echo "Bookmark that URL — it is the address to reopen from now on."
echo "Leave this window open while you use the binder. Ctrl-C or close it when done."
echo

# Give the server a moment to bind before the browser asks for the page.
( sleep 1; open "$URL" ) &

exec python3 -m http.server "$PORT" --bind 127.0.0.1

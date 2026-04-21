#!/bin/bash
# Quick smoke test for the laptop bridge.
set -e
pkill -f 'bun run bridge.ts' 2>/dev/null || true
sleep 1
mkdir -p /tmp/bridge-test
echo 'hello world' > /tmp/bridge-test/example.txt

cd "$(dirname "$0")"
bun run bridge.ts /tmp/bridge-test --port 3928 > /tmp/bridge.log 2>&1 &
BRIDGE_PID=$!
sleep 3

TOKEN=$(grep -oP 'Token  : \K\S+' /tmp/bridge.log)
echo "Token: $TOKEN"

echo "=== INITIALIZE ==="
INIT=$(curl -sS -D /tmp/init-headers.txt -X POST http://localhost:3928/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}')
echo "$INIT"
SESSION=$(grep -oiP 'mcp-session-id:\s*\K\S+' /tmp/init-headers.txt | tr -d '\r')
echo "Session: $SESSION"

echo
echo "=== NOTIFY INITIALIZED ==="
curl -sS -X POST http://localhost:3928/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'
echo

echo "=== LIST TOOLS ==="
curl -sS -X POST http://localhost:3928/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
echo

echo "=== CALL list_local_files ==="
curl -sS -X POST http://localhost:3928/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_local_files","arguments":{}}}'
echo

echo "=== CALL read_local_file example.txt ==="
curl -sS -X POST http://localhost:3928/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"read_local_file","arguments":{"path":"example.txt"}}}'
echo

echo "=== CALL write_local_file new.txt ==="
curl -sS -X POST http://localhost:3928/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"write_local_file","arguments":{"path":"new.txt","content":"from AI"}}}'
echo

echo "=== written file ==="
cat /tmp/bridge-test/new.txt
echo

kill $BRIDGE_PID 2>/dev/null || true
wait $BRIDGE_PID 2>/dev/null || true
echo "=== Done ==="

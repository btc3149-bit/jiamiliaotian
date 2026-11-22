#!/bin/sh
# Supervised startup for the Docker image ONLY (item 32). The Worker path
# does not use this file. Previously the image ran
#   sh -c "node … & nginx -g 'daemon off;'"
# so a crashed relay left nginx serving 502s while the container still
# looked healthy. Here both processes are watched: if either exits, the
# other is stopped and the container exits non-zero for the orchestrator
# (restart policy / HEALTHCHECK) to act on. Signals are forwarded to both.
# 仅 Docker 路径使用：同时监管 node 与 nginx，任一退出即停掉另一个并
# 以非零码退出容器，避免中继崩溃后容器假健康；信号转发给两个进程。
set -u

node --expose-gc --unhandled-rejections=strict /app/server/server.js &
NODE_PID=$!

nginx -g 'daemon off;' &
NGINX_PID=$!

shutdown() {
	kill "$NODE_PID" "$NGINX_PID" 2>/dev/null
	wait "$NODE_PID" 2>/dev/null
	wait "$NGINX_PID" 2>/dev/null
}

trap 'shutdown; exit 143' TERM
trap 'shutdown; exit 130' INT

while kill -0 "$NODE_PID" 2>/dev/null && kill -0 "$NGINX_PID" 2>/dev/null; do
	sleep 1
done

# One of the two died on its own: take the container down with it.
shutdown
exit 1

#!/data/data/com.termux/files/usr/bin/sh
# Copy to ~/.termux/boot/start-all.sh and `chmod +x`. Needs the Termux:Boot app opened once.
termux-wake-lock
# Stop leftovers first, so a restart never fails with "address already in use".
pkill -f "node server.js" 2>/dev/null
pkill -f "uvicorn eq_server" 2>/dev/null
pkill cloudflared 2>/dev/null
nginx -s stop 2>/dev/null
sleep 2
sshd
cd ~/gym/api && set -a && . ~/gym/.env && set +a && nohup node server.js >> ~/gym/api.log 2>&1 &
cd ~/eq && nohup uvicorn eq_server:app --host 127.0.0.1 --port 8082 >> ~/eq/eq.log 2>&1 &
nginx
nohup cloudflared tunnel run s21 >> ~/cloudflared.log 2>&1 &

#!/usr/bin/env bash
# 在腾讯云轻量 Ubuntu 上执行（2C2G 网关）。需要 root。
set -euo pipefail
DOMAIN="${DOMAIN:-162-14-78-238.sslip.io}"
FRP_VER="${FRP_VER:-0.61.1}"
TOKEN="${FRP_TOKEN:-CHANGE_ME_FRP_TOKEN}"

apt-get update
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl ufw
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy

install -d /opt/frp
curl -fsSL -o /tmp/frp.tgz "https://github.com/fatedier/frp/releases/download/v${FRP_VER}/frp_${FRP_VER}_linux_amd64.tar.gz"
tar -xzf /tmp/frp.tgz -C /tmp
cp "/tmp/frp_${FRP_VER}_linux_amd64/frps" /opt/frp/frps
chmod +x /opt/frp/frps

cat >/opt/frp/frps.toml <<EOF
bindAddr = "0.0.0.0:7000"
auth.token = "${TOKEN}"
webServer.addr = "127.0.0.1:7500"
EOF

cat >/etc/systemd/system/frps.service <<'EOF'
[Unit]
Description=frp server
After=network.target
[Service]
ExecStart=/opt/frp/frps -c /opt/frp/frps.toml
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now frps

# Caddyfile 由仓库 deploy/Caddyfile 覆盖；此处写一份默认。
cat >/etc/caddy/Caddyfile <<EOF
{
	email admin@localhost
}

${DOMAIN} {
	encode gzip
	handle /api/* {
		reverse_proxy 127.0.0.1:15181
	}
	handle {
		reverse_proxy 127.0.0.1:15180
	}
}

ai.${DOMAIN} {
	encode gzip
	reverse_proxy 127.0.0.1:13081
}

kb.${DOMAIN} {
	encode gzip
	reverse_proxy 127.0.0.1:18090
}
EOF
systemctl reload caddy || systemctl restart caddy

ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 7000/tcp
ufw --force enable

echo "网关已启动。安全组请只放行 80/443/7000；7000 最好限制来源为本机公网 IP。"
echo "把 deploy/frpc.toml 的 auth.token 改成与云机相同后，在 Windows 运行 deploy/start-frpc.ps1"

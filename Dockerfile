FROM caddy:2-alpine

COPY container/Caddyfile /etc/caddy/Caddyfile
COPY site /srv

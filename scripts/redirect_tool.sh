#!/bin/bash
# Turn a retired PHP tool account into a Toolforge redirect container that
# forwards every request to the matching magpie sub-tool.
#
#   cat scripts/redirect_tool.sh | ssh magnus@login.toolforge.org "become <tool> bash -s"
#
# The tool name is taken from the account, so the script needs no arguments.
# Toolforge's redirect container answers 308, which keeps the query string,
# the method and the POST body; `%s` keeps the path, so the old `/api.php`,
# `/index.php` and Geograph's `/g2c.php` still resolve. The account's own
# `public_html/` is left untouched.
set -euo pipefail

tool=$(whoami | cut -d. -f2)
# Every tool with a view in magpie is a valid redirect target.
case "$tool" in
  flickr2commons | url2commons | geograph2commons | commonshelper) ;;
  *)
    echo "not a magpie sub-tool account: $tool" >&2
    exit 1
    ;;
esac

cat > "$HOME/service.template" <<'EOF'
type: buildservice
buildservice-image: tool-containers/redirect:latest
health-check-path: /healthz
mount: none
cpu: 125m
mem: 128Mi
EOF

# `create` also updates an existing variable. Do not use `envvars delete`: it
# asks for confirmation on stdin, which is this script.
toolforge envvars create REDIRECT_HOST magpie.toolforge.org
toolforge envvars create REDIRECT_PATH "/${tool}%s"

toolforge webservice stop || true
toolforge webservice start
toolforge webservice status

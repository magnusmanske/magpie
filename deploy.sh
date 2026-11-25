#!/usr/bin/env bash
# Delopy and restart toolforge services
ssh login.toolforge.org 'become magpie bash -lc "cd ~/magpie/ && git pull && ./build.sh && webservice restart && echo \"OK\""'

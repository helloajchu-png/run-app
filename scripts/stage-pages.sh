#!/bin/sh
echo "Deploy the app directory, not the repo root:"
echo "  npx wrangler pages deploy site --project-name run-together"
echo "If that name is taken, use --project-name run-together-app"
echo "Do not merge this branch until that Pages URL is up."

# Private Repository Upload Prep

This project should be uploaded from this directory, not from the parent `New project` directory. The parent directory is a separate Git repository and also contains unrelated projects.

## Current Prep

- New readers should start with `README.md`, `docs/product/INTRODUCTION.md`, and `docs/engineering/GETTING_STARTED.md`.
- Keep `.env.local` private. Use `.env.example` for placeholder configuration.
- Tell users to copy `.env.example` to `.env.local` and put their own provider key in `LLM_API_KEY`.
- Do not use `VITE_*` for secrets; Vite exposes those values to browser code.
- Keep generated files out of Git: `node_modules/`, `dist/`, `*.tsbuildinfo`, runtime state, logs, and verification screenshots.
- Commit the project from `knowledge-feed-learning/` after verifying the file set.

## Suggested Commands

```bash
git init
git status --short
git add .
git status --short
npm run verify:local
git commit -m "Prepare KnowFeed for private repository upload"
git branch -M main
git remote add origin <private-repo-url>
git push -u origin main
```

If this directory is already initialized as a standalone repository, skip `git init` and only add the private remote if it is missing or incorrect.

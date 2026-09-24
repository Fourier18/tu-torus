# Coding Tutor

Design and every decision behind it: [DESIGN.md](./DESIGN.md).

## To open it

Double-click **Start Coding Tutor.bat** in this folder. It starts everything and opens your browser automatically. To close it, double-click **Stop Coding Tutor.bat** (closing the window the start script opens does not stop it).

No desktop icon — this folder is the app.

## First-time setup (once)

```bash
npm run setup   # installs both server and frontend dependencies
```

Docker Desktop must also be installed.

## For development (terminal, not the batch file)

```bash
npm run dev
```

## Requirements

- Node 18+
- Docker Desktop, installed (the start script launches it automatically if it isn't running)

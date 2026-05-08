# Cosmos Multiplayer Starter

Monorepo starter for a multiplayer game using:

- Node.js + TypeScript backend with WebSocket (`ws`)
- React + TypeScript frontend with Vite
- Shared protocol types in a dedicated package

## Scripts

- `npm install`
- `npm run dev` to run shared watcher, game server, and web client
- `npm run build` to build all packages
- `npm run typecheck` to run TypeScript checks

## Default Ports

- Client: `5173`
- Server (HTTP + WS): `5001`

## 3D Controls

- Click inside 3D viewport to lock mouse pointer
- Move mouse to change orientation (yaw/pitch)
- `W/S` fly forward/backward relative to camera orientation
- `A/D` strafe left/right
- Your own player model is not rendered (first-person view)
- Other players are rendered as pyramids

## Next Steps

1. Add room/session management on the server.
2. Add authoritative game loop and server reconciliation.
3. Add authentication and reconnect flow.
4. Add persistence (Redis/PostgreSQL) for matches and players.

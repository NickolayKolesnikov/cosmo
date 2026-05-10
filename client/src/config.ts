const serverHost = (import.meta.env.VITE_GAME_SERVER_HOST as string | undefined) ?? "127.0.0.1";
const serverPortRaw = (import.meta.env.VITE_GAME_SERVER_PORT as string | undefined) ?? "5001";
const serverPort = Number(serverPortRaw);

export const wsUrl = `ws://${serverHost}:${Number.isFinite(serverPort) ? serverPort : 5001}`;

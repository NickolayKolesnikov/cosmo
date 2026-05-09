import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage_t, ServerMessage_t, WorldState_t } from "@cosmos/shared";

export type ConnectionState_t = "connecting" | "open" | "closed";

const initialWorldState: WorldState_t = {
  roomId: null,
  roomName: null,
  roomPlayerIds: [],
  availableRooms: [],
  players: [],
  projectiles: [],
  missiles: [],
  explosions: [],
  supplyCubes: [],
  transports: [],
  serverTimeMs: 0,
};

export const useServerConnection = (url: string) => {
  const [connection, setConnection] = useState<ConnectionState_t>("connecting");
  const [playerId, setPlayerId] = useState<string>("");
  const [world, setWorld] = useState<WorldState_t>(initialWorldState);
  const [latencyMs, setLatencyMs] = useState<number>(0);
  const [errorText, setErrorText] = useState<string>("");

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  const sendMessage = useCallback((payload: ClientMessage_t): boolean => {
    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setErrorText("No server connection yet. Client is reconnecting...");
      return false;
    }

    socket.send(JSON.stringify(payload));
    return true;
  }, []);

  useEffect(() => {
    let disposed = false;

    const connect = () => {
      if (disposed) {
        return;
      }

      setConnection("connecting");
      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.onopen = () => {
        setConnection("open");
        setErrorText("");
      };

      socket.onclose = () => {
        if (disposed) {
          return;
        }

        setConnection("closed");
        reconnectTimerRef.current = window.setTimeout(connect, 1200);
      };

      socket.onmessage = (event) => {
        let message: ServerMessage_t;

        try {
          message = JSON.parse(String(event.data)) as ServerMessage_t;
        } catch {
          return;
        }

        if (message.type === "welcome") {
          setPlayerId(message.playerId);
          return;
        }

        if (message.type === "world") {
          setWorld(message.state);
          return;
        }

        if (message.type === "pong") {
          setLatencyMs(Math.max(0, Date.now() - message.sentAtMs));
          return;
        }

        if (message.type === "error") {
          setErrorText(message.message);
        }
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }

      const socket = socketRef.current;
      if (socket) {
        socket.close();
      }
    };
  }, [url]);

  useEffect(() => {
    if (connection !== "open") {
      return;
    }

    const intervalId = window.setInterval(() => {
      sendMessage({ type: "ping", sentAtMs: Date.now() });
    }, 1500);

    return () => window.clearInterval(intervalId);
  }, [connection, sendMessage]);

  return {
    connection,
    playerId,
    world,
    latencyMs,
    errorText,
    setErrorText,
    sendMessage,
  };
};

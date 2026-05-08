import { useEffect, useRef, useState } from "react";
import type { ClientMessage_t, ServerMessage_t, WorldState_t } from "@cosmos/shared";
import { ARENA_SIZE_PX, PLAYER_DOT_SIZE_PX, PLAYER_RADIUS_PX } from "@cosmos/shared";

const wsUrl = "ws://localhost:5001";
const arenaSizePx = ARENA_SIZE_PX;

type ConnectionState_t = "connecting" | "open" | "closed";

export function App() {
  const [connection, setConnection] = useState<ConnectionState_t>("connecting");
  const [playerId, setPlayerId] = useState<string>("");
  const [world, setWorld] = useState<WorldState_t>({
    roomId: null,
    roomName: null,
    roomPlayerIds: [],
    availableRooms: [],
    players: [],
    serverTimeMs: 0,
  });
  const [latencyMs, setLatencyMs] = useState<number>(0);
  const [roomName, setRoomName] = useState<string>("");
  const [errorText, setErrorText] = useState<string>("");
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  const sendMessage = (payload: ClientMessage_t): boolean => {
    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setErrorText("No server connection yet. Client is reconnecting...");
      return false;
    }

    socket.send(JSON.stringify(payload));
    return true;
  };

  useEffect(() => {
    let disposed = false;

    const connect = () => {
      if (disposed) {
        return;
      }

      setConnection("connecting");
      const socket = new WebSocket(wsUrl);
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
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (connection !== "open") {
        return;
      }

      if (!world.roomId) {
        return;
      }

      const payload: ClientMessage_t = (() => {
        if (event.key === "ArrowUp" || event.key === "w") {
          return { type: "move", dx: 0, dy: -1 };
        }

        if (event.key === "ArrowDown" || event.key === "s") {
          return { type: "move", dx: 0, dy: 1 };
        }

        if (event.key === "ArrowLeft" || event.key === "a") {
          return { type: "move", dx: -1, dy: 0 };
        }

        return { type: "move", dx: 1, dy: 0 };
      })();

      const isMoveKey = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d"].includes(
        event.key
      );

      if (!isMoveKey) {
        return;
      }

      sendMessage(payload);
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [connection, world.roomId]);

  useEffect(() => {
    if (connection !== "open") {
      return;
    }

    const intervalId = window.setInterval(() => {
      const ping: ClientMessage_t = { type: "ping", sentAtMs: Date.now() };
      sendMessage(ping);
    }, 1500);

    return () => window.clearInterval(intervalId);
  }, [connection]);

  const createRoom = () => {
    const payload: ClientMessage_t = {
      type: "create_room",
      roomName,
    };

    setErrorText("");
    const sent = sendMessage(payload);
    if (sent) {
      setRoomName("");
    }
  };

  const joinRoom = (roomId: string) => {
    const payload: ClientMessage_t = {
      type: "join_room",
      roomId,
    };

    setErrorText("");
    sendMessage(payload);
  };

  return (
    <main className="page">
      <h1>Cosmos Multiplayer</h1>
      <p>
        Status: <strong>{connection}</strong> | You: <strong>{playerId || "pending"}</strong> | Ping:
        <strong> {latencyMs} ms</strong>
      </p>
      <p>{world.roomId ? "Use WASD or arrow keys to move." : "Create or join a room to start playing."}</p>

      <section className="rooms">
        <h2>Rooms</h2>
        <div className="room-actions">
          <input
            value={roomName}
            onChange={(event) => setRoomName(event.target.value)}
            placeholder="Room name"
            maxLength={40}
          />
          <button type="button" onClick={createRoom}>
            Create room
          </button>
        </div>
        {errorText ? <p className="error-text">{errorText}</p> : null}
        <ul className="room-list">
          {world.availableRooms.map((room) => {
            const isCurrent = room.id === world.roomId;
            return (
              <li key={room.id}>
                <span>
                  {room.name} ({room.playerCount})
                </span>
                <button type="button" onClick={() => joinRoom(room.id)} disabled={isCurrent}>
                  {isCurrent ? "Joined" : "Join"}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="room-members">
        <h2>Players In Room</h2>
        <p>
          Current room: <strong>{world.roomName ?? "No room selected"}</strong>
        </p>
        <ul>
          {world.roomPlayerIds.map((id) => (
            <li key={id}>{id === playerId ? `${id} (you)` : id}</li>
          ))}
        </ul>
      </section>

      <section className="arena" aria-label="Game arena">
        {world.players.map((player) => {
          const isSelf = player.id === playerId;
          return (
            <div
              key={player.id}
              className={`dot ${isSelf ? "self" : "other"}`}
              style={{
                left: `${Math.max(PLAYER_RADIUS_PX, Math.min(arenaSizePx - PLAYER_RADIUS_PX, player.position.x))}px`,
                top: `${Math.max(PLAYER_RADIUS_PX, Math.min(arenaSizePx - PLAYER_RADIUS_PX, player.position.y))}px`,
                width: `${PLAYER_DOT_SIZE_PX}px`,
                height: `${PLAYER_DOT_SIZE_PX}px`,
                backgroundColor: player.color,
              }}
              title={isSelf ? "You" : player.id}
            />
          );
        })}
      </section>
    </main>
  );
}

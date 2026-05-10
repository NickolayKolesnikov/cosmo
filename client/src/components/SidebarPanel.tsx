import type { WorldState_t } from "@cosmos/shared";

type SidebarPanelProps_t = {
  connection: "connecting" | "open" | "closed";
  playerId: string;
  latencyMs: number;
  roomName: string;
  errorText: string;
  isPointerLocked: boolean;
  world: WorldState_t;
  onRoomNameChange: (value: string) => void;
  onCreateRoom: () => void;
  onJoinRoom: (roomId: string) => void;
};

export const SidebarPanel = ({
  connection,
  playerId,
  latencyMs,
  roomName,
  errorText,
  isPointerLocked,
  world,
  onRoomNameChange,
  onCreateRoom,
  onJoinRoom,
}: SidebarPanelProps_t) => {
  const roomPlayerById = new Map(world.players.map((player) => [player.id, player]));

  return (
    <aside className="sidebar">
      <h1>Cosmos Multiplayer</h1>
      <p>
        Status: <strong>{connection}</strong> | You: <strong>{playerId || "pending"}</strong> | Ping:
        <strong> {latencyMs} ms</strong>
      </p>
      <p>
        {world.roomId
          ? "Click 3D view to lock mouse. Move mouse or Arrow keys to rotate. W/S fly forward/back, A/D strafe, Q/E roll, LMB or Space shoot, RMB or R launch homing missile on red target."
          : "Create or join a room to start playing."}
      </p>
      <p>Mouse lock: {isPointerLocked ? "active" : "inactive"}</p>

      <section className="rooms">
        <h2>Rooms</h2>
        <div className="room-actions">
          <input
            value={roomName}
            onChange={(event) => onRoomNameChange(event.target.value)}
            placeholder="Room name"
            maxLength={40}
          />
          <button type="button" onClick={onCreateRoom}>
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
                <button type="button" onClick={() => onJoinRoom(room.id)} disabled={isCurrent}>
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
          {world.roomPlayerIds.map((id) => {
            const playerState = roomPlayerById.get(id);
            const kdText = playerState ? `${playerState.killed}/${playerState.dead} killed/dead` : "0/0 killed/dead";
            return <li key={id}>{id === playerId ? `${id} (you) - ${kdText}` : `${id} - ${kdText}`}</li>;
          })}
        </ul>
      </section>
    </aside>
  );
};

export type Vec2_t = {
  x: number;
  y: number;
};

export const ARENA_SIZE_PX = 560;
export const PLAYER_DOT_SIZE_PX = 18;
export const PLAYER_RADIUS_PX = PLAYER_DOT_SIZE_PX / 2;

export type PlayerId_t = string;
export type RoomId_t = string;

export type PlayerState_t = {
  id: PlayerId_t;
  position: Vec2_t;
  color: string;
};

export type WorldState_t = {
  roomId: RoomId_t | null;
  roomName: string | null;
  roomPlayerIds: PlayerId_t[];
  availableRooms: RoomSummary_t[];
  players: PlayerState_t[];
  serverTimeMs: number;
};

export type RoomSummary_t = {
  id: RoomId_t;
  name: string;
  playerCount: number;
};

export type ClientMessage_t =
  | {
      type: "move";
      dx: number;
      dy: number;
    }
  | {
      type: "create_room";
      roomName: string;
    }
  | {
      type: "join_room";
      roomId: RoomId_t;
    }
  | {
      type: "ping";
      sentAtMs: number;
    };

export type ServerMessage_t =
  | {
      type: "welcome";
      playerId: PlayerId_t;
    }
  | {
      type: "world";
      state: WorldState_t;
    }
  | {
      type: "pong";
      sentAtMs: number;
      serverTimeMs: number;
    }
  | {
      type: "error";
      message: string;
    };

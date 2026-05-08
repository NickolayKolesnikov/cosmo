export type Vec3_t = {
  x: number;
  y: number;
  z: number;
};

export const WORLD_HALF_EXTENT = 180;

export type PlayerId_t = string;
export type RoomId_t = string;

export type PlayerState_t = {
  id: PlayerId_t;
  position: Vec3_t;
  yaw: number;
  pitch: number;
  roll: number;
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
      type: "input";
      forward: number;
      strafe: number;
    }
  | {
      type: "look";
      yaw: number;
      pitch: number;
      roll: number;
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

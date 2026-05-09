export type Vec3_t = {
  x: number;
  y: number;
  z: number;
};

export type Quaternion_t = {
  x: number;
  y: number;
  z: number;
  w: number;
};

export const WORLD_HALF_EXTENT = 600;

export type PlayerId_t = string;
export type RoomId_t = string;

export type PlayerState_t = {
  id: PlayerId_t;
  position: Vec3_t;
  yaw: number;
  pitch: number;
  roll: number;
  orientation: Quaternion_t;
  health: number;
  projectileAmmo: number;
  missileAmmo: number;
  isAlive: boolean;
  color: string;
};

export type ProjectileState_t = {
  id: string;
  ownerId: PlayerId_t;
  position: Vec3_t;
  velocity: Vec3_t;
};

export type MissileState_t = {
  id: string;
  ownerId: PlayerId_t;
  targetId: PlayerId_t;
  position: Vec3_t;
  velocity: Vec3_t;
};

export type ExplosionState_t = {
  id: string;
  position: Vec3_t;
  life: number;
};

export type SupplyCubeType_t = "projectile_ammo" | "missile_ammo" | "health";

export type SupplyCubeState_t = {
  id: string;
  position: Vec3_t;
  cubeType: SupplyCubeType_t;
};

export type WorldState_t = {
  roomId: RoomId_t | null;
  roomName: string | null;
  roomPlayerIds: PlayerId_t[];
  availableRooms: RoomSummary_t[];
  players: PlayerState_t[];
  projectiles: ProjectileState_t[];
  missiles: MissileState_t[];
  explosions: ExplosionState_t[];
  supplyCubes: SupplyCubeState_t[];
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
      type: "shoot";
    }
  | {
      type: "launch_homing";
      targetId: PlayerId_t;
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

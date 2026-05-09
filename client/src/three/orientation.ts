import { Euler, Quaternion } from "three";

const fullTurn = Math.PI * 2;

export type LookAngles_t = {
  yaw: number;
  pitch: number;
  roll: number;
};

export const normalizeAngle = (value: number): number => {
  let angle = value;
  while (angle > Math.PI) {
    angle -= fullTurn;
  }
  while (angle < -Math.PI) {
    angle += fullTurn;
  }
  return angle;
};

export const extractLookAnglesFromOrientation = (orientation: Quaternion, eulerScratch: Euler): LookAngles_t => {
  eulerScratch.setFromQuaternion(orientation, "YXZ");

  return {
    yaw: normalizeAngle(eulerScratch.y),
    pitch: eulerScratch.x,
    roll: normalizeAngle(eulerScratch.z),
  };
};

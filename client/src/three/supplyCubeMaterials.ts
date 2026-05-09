import type { SupplyCubeType_t } from "@cosmos/shared";
import { CanvasTexture, MeshStandardMaterial } from "three";

const createProjectileShellTexture = (): CanvasTexture => {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;

  const context = canvas.getContext("2d");
  if (!context) {
    return new CanvasTexture(canvas);
  }

  context.fillStyle = "#5dff91";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = "#1d6b36";
  context.fillRect(56, 22, 16, 62);

  context.beginPath();
  context.moveTo(64, 12);
  context.lineTo(52, 30);
  context.lineTo(76, 30);
  context.closePath();
  context.fill();

  context.fillStyle = "#d3ad64";
  context.fillRect(50, 84, 28, 24);

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
};

const createProjectileOrbTexture = (): CanvasTexture => {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;

  const context = canvas.getContext("2d");
  if (!context) {
    return new CanvasTexture(canvas);
  }

  context.fillStyle = "#5dff91";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.beginPath();
  context.arc(64, 64, 26, 0, Math.PI * 2);
  context.fillStyle = "#e8f6ff";
  context.fill();

  context.beginPath();
  context.arc(64, 64, 16, 0, Math.PI * 2);
  context.fillStyle = "#5bc0eb";
  context.fill();

  context.beginPath();
  context.arc(56, 56, 6, 0, Math.PI * 2);
  context.fillStyle = "rgba(255, 255, 255, 0.7)";
  context.fill();

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
};

const createMedicalCrossTexture = (): CanvasTexture => {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;

  const context = canvas.getContext("2d");
  if (!context) {
    return new CanvasTexture(canvas);
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = "#d91a1a";
  context.fillRect(54, 26, 20, 76);
  context.fillRect(26, 54, 76, 20);

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
};

const projectileShellTexture = createProjectileShellTexture();
const projectileOrbTexture = createProjectileOrbTexture();
const medicalCrossTexture = createMedicalCrossTexture();

export const getSupplyCubeMaterialByType = (cubeType: SupplyCubeType_t): MeshStandardMaterial => {
  if (cubeType === "projectile_ammo") {
    return new MeshStandardMaterial({
      color: "#ffffff",
      map: projectileOrbTexture,
      emissive: "#117a2f",
      emissiveIntensity: 0.95,
    });
  }

  if (cubeType === "missile_ammo") {
    return new MeshStandardMaterial({
      color: "#ff6161",
      map: projectileShellTexture,
      emissive: "#7f1b1b",
      emissiveIntensity: 0.95,
    });
  }

  return new MeshStandardMaterial({
    color: "#ffffff",
    map: medicalCrossTexture,
    emissive: "#5d5d5d",
    emissiveIntensity: 0.72,
  });
};

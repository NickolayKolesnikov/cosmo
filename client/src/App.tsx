import { useEffect, useRef, useState } from "react";
import type { ClientMessage_t, ServerMessage_t, SupplyCubeType_t, WorldState_t } from "@cosmos/shared";
import { WORLD_HALF_EXTENT } from "@cosmos/shared";
import { wsUrl } from "./config";
import {
  AmbientLight,
  AxesHelper,
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  GridHelper,
  Mesh,
  MeshStandardMaterial,
  Euler,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";

const mouseSensitivity = 0.0022;
const rollStepPerFrame = 0.02;
const fullTurn = Math.PI * 2;

const normalizeAngle = (value: number): number => {
  let angle = value;
  while (angle > Math.PI) {
    angle -= fullTurn;
  }
  while (angle < -Math.PI) {
    angle += fullTurn;
  }
  return angle;
};

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

const getSupplyCubeMaterialByType = (cubeType: SupplyCubeType_t): MeshStandardMaterial => {
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

type ConnectionState_t = "connecting" | "open" | "closed";

type ThreeContext_t = {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
};

type SoundEffect_t =
  | "projectile_shot"
  | "missile_launch"
  | "projectile_hit"
  | "missile_hit"
  | "resource_pickup"
  | "damage_taken";

type SelfStatsSnapshot_t = {
  health: number;
  projectileAmmo: number;
  missileAmmo: number;
  isAlive: boolean;
};

export function App() {
  const [connection, setConnection] = useState<ConnectionState_t>("connecting");
  const [playerId, setPlayerId] = useState<string>("");
  const [world, setWorld] = useState<WorldState_t>({
    roomId: null,
    roomName: null,
    roomPlayerIds: [],
    availableRooms: [],
    players: [],
    projectiles: [],
    missiles: [],
    explosions: [],
    supplyCubes: [],
    serverTimeMs: 0,
  });
  const [latencyMs, setLatencyMs] = useState<number>(0);
  const [roomName, setRoomName] = useState<string>("");
  const [errorText, setErrorText] = useState<string>("");
  const [isPointerLocked, setIsPointerLocked] = useState<boolean>(false);
  const [isCrosshairHot, setIsCrosshairHot] = useState<boolean>(false);
  const [damageFlashId, setDamageFlashId] = useState<number>(0);

  const worldRef = useRef<WorldState_t>(world);
  const playerIdRef = useRef<string>("");
  const selfPositionRef = useRef(new Vector3(0, 0, 0));
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const rollRef = useRef(0);
  const orientationRef = useRef(new Quaternion());
  const eulerRef = useRef(new Euler(0, 0, 0, "YXZ"));
  const qYawRef = useRef(new Quaternion());
  const qPitchRef = useRef(new Quaternion());
  const qRollRef = useRef(new Quaternion());
  const localUpRef = useRef(new Vector3(0, 1, 0));
  const localRightRef = useRef(new Vector3(1, 0, 0));
  const localForwardRef = useRef(new Vector3(0, 0, -1));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const threeRef = useRef<ThreeContext_t | null>(null);
  const meshesRef = useRef(new Map<string, Mesh>());
  const projectileMeshesRef = useRef(new Map<string, Mesh>());
  const missileMeshesRef = useRef(new Map<string, Mesh>());
  const explosionMeshesRef = useRef(new Map<string, Mesh>());
  const supplyCubeMeshesRef = useRef(new Map<string, Mesh>());
  const keyStateRef = useRef({ w: false, a: false, s: false, d: false, q: false, e: false });
  const centerNdcRef = useRef(new Vector2(0, 0));
  const raycasterRef = useRef(new Raycaster());
  const isCrosshairHotRef = useRef(false);
  const hoveredTargetIdRef = useRef<string | null>(null);
  const missileUpAxisRef = useRef(new Vector3(0, 1, 0));
  const missileDirRef = useRef(new Vector3());
  const lastSelfHealthRef = useRef<number | null>(null);
  const previousWorldRef = useRef<WorldState_t | null>(null);
  const previousSelfStatsRef = useRef<SelfStatsSnapshot_t | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

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

  const ensureAudioContext = (): AudioContext | null => {
    const existing = audioContextRef.current;
    if (existing) {
      if (existing.state === "suspended") {
        void existing.resume();
      }
      return existing;
    }

    const audioCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!audioCtor) {
      return null;
    }

    const context = new audioCtor();
    audioContextRef.current = context;
    return context;
  };

  const playTone = (
    context: AudioContext,
    options: {
      frequencyStart: number;
      frequencyEnd: number;
      gainStart: number;
      gainEnd: number;
      durationSec: number;
      type: OscillatorType;
      startDelaySec?: number;
    }
  ): void => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startDelay = options.startDelaySec ?? 0;
    const startTime = context.currentTime + startDelay;
    const endTime = startTime + options.durationSec;

    oscillator.type = options.type;
    oscillator.frequency.setValueAtTime(options.frequencyStart, startTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, options.frequencyEnd), endTime);

    gain.gain.setValueAtTime(options.gainStart, startTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, options.gainEnd), endTime);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startTime);
    oscillator.stop(endTime + 0.02);
  };

  const playSoundEffect = (effect: SoundEffect_t): void => {
    const context = ensureAudioContext();
    if (!context) {
      return;
    }

    if (effect === "projectile_shot") {
      playTone(context, {
        frequencyStart: 620,
        frequencyEnd: 420,
        gainStart: 0.07,
        gainEnd: 0.0001,
        durationSec: 0.09,
        type: "square",
      });
      return;
    }

    if (effect === "missile_launch") {
      playTone(context, {
        frequencyStart: 190,
        frequencyEnd: 85,
        gainStart: 0.1,
        gainEnd: 0.0001,
        durationSec: 0.24,
        type: "sawtooth",
      });
      return;
    }

    if (effect === "projectile_hit") {
      playTone(context, {
        frequencyStart: 320,
        frequencyEnd: 140,
        gainStart: 0.08,
        gainEnd: 0.0001,
        durationSec: 0.12,
        type: "triangle",
      });
      return;
    }

    if (effect === "damage_taken") {
      playTone(context, {
        frequencyStart: 240,
        frequencyEnd: 95,
        gainStart: 0.1,
        gainEnd: 0.0001,
        durationSec: 0.16,
        type: "triangle",
      });
      return;
    }

    if (effect === "missile_hit") {
      playTone(context, {
        frequencyStart: 140,
        frequencyEnd: 52,
        gainStart: 0.12,
        gainEnd: 0.0001,
        durationSec: 0.3,
        type: "sawtooth",
      });
      return;
    }

    playTone(context, {
      frequencyStart: 460,
      frequencyEnd: 620,
      gainStart: 0.07,
      gainEnd: 0.0001,
      durationSec: 0.09,
      type: "sine",
    });
    playTone(context, {
      frequencyStart: 620,
      frequencyEnd: 780,
      gainStart: 0.05,
      gainEnd: 0.0001,
      durationSec: 0.09,
      type: "sine",
      startDelaySec: 0.09,
    });
  };

  const sendLook = (): void => {
    sendMessage({
      type: "look",
      yaw: yawRef.current,
      pitch: pitchRef.current,
      roll: rollRef.current,
    });
  };

  const syncLookRefsFromOrientation = (): void => {
    eulerRef.current.setFromQuaternion(orientationRef.current, "YXZ");
    yawRef.current = normalizeAngle(eulerRef.current.y);
    pitchRef.current = eulerRef.current.x;
    rollRef.current = normalizeAngle(eulerRef.current.z);
  };

  useEffect(() => {
    worldRef.current = world;
  }, [world]);

  useEffect(() => {
    const self = world.players.find((player) => player.id === playerId);
    if (!self) {
      lastSelfHealthRef.current = null;
      return;
    }

    const previousHealth = lastSelfHealthRef.current;
    if (previousHealth !== null && self.health < previousHealth) {
      setDamageFlashId((value) => value + 1);
      playSoundEffect("damage_taken");
    }

    lastSelfHealthRef.current = self.health;
  }, [playerId, world]);

  useEffect(() => {
    const self = world.players.find((player) => player.id === playerId);
    const previousSelf = previousSelfStatsRef.current;
    const previousWorld = previousWorldRef.current;

    if (self && previousSelf) {
      if (self.projectileAmmo < previousSelf.projectileAmmo) {
        playSoundEffect("projectile_shot");
      }

      if (self.missileAmmo < previousSelf.missileAmmo) {
        playSoundEffect("missile_launch");
      }

      const resourceIncreased =
        self.health > previousSelf.health ||
        self.projectileAmmo > previousSelf.projectileAmmo ||
        self.missileAmmo > previousSelf.missileAmmo;
      if (resourceIncreased && self.isAlive && previousSelf.isAlive) {
        playSoundEffect("resource_pickup");
      }
    }

    if (previousWorld && world.roomId && previousWorld.roomId === world.roomId) {
      const explosionIncreased = world.explosions.length > previousWorld.explosions.length;
      if (explosionIncreased && world.missiles.length < previousWorld.missiles.length) {
        playSoundEffect("missile_hit");
      } else if (explosionIncreased && world.projectiles.length < previousWorld.projectiles.length) {
        playSoundEffect("projectile_hit");
      }
    }

    previousSelfStatsRef.current = self
      ? {
          health: self.health,
          projectileAmmo: self.projectileAmmo,
          missileAmmo: self.missileAmmo,
          isAlive: self.isAlive,
        }
      : null;
    previousWorldRef.current = world;
  }, [playerId, world]);

  useEffect(() => {
    return () => {
      const context = audioContextRef.current;
      if (context) {
        void context.close();
        audioContextRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    playerIdRef.current = playerId;
  }, [playerId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const scene = new Scene();
    scene.background = new Color("#0b1220");

    const camera = new PerspectiveCamera(75, 1, 0.1, 2000);

    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    scene.add(new AmbientLight(0xffffff, 0.45));
    const directional = new DirectionalLight(0xffffff, 0.85);
    directional.position.set(60, 90, 40);
    scene.add(directional);

    scene.add(new GridHelper(WORLD_HALF_EXTENT * 2, 24, 0x3f5e8a, 0x1f2b45));
    scene.add(new AxesHelper(28));

    const boundary = new Mesh(
      new BoxGeometry(WORLD_HALF_EXTENT * 2, WORLD_HALF_EXTENT * 2, WORLD_HALF_EXTENT * 2),
      new MeshStandardMaterial({ color: "#4d6a93", wireframe: true, transparent: true, opacity: 0.12 })
    );
    scene.add(boundary);

    threeRef.current = { scene, camera, renderer };

    const resize = () => {
      const width = container.clientWidth;
      const height = Math.max(280, container.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    resize();
    window.addEventListener("resize", resize);

    let frameId = 0;
    const draw = () => {
      const self = worldRef.current.players.find((p) => p.id === playerIdRef.current);
      if (self) {
        selfPositionRef.current.set(self.position.x, self.position.y, self.position.z);
      }

      camera.position.copy(selfPositionRef.current);
      camera.quaternion.copy(orientationRef.current);
      const rollInput = (keyStateRef.current.e ? 1 : 0) + (keyStateRef.current.q ? -1 : 0);
      if (rollInput !== 0) {
        qRollRef.current.setFromAxisAngle(localForwardRef.current, rollInput * rollStepPerFrame);
        orientationRef.current.multiply(qRollRef.current).normalize();
        camera.quaternion.copy(orientationRef.current);
      }

      const raycaster = raycasterRef.current;
      const targetMeshes = [...meshesRef.current.values()];
      let isHot = false;
      let hoveredTargetId: string | null = null;
      if (targetMeshes.length > 0 && worldRef.current.roomId) {
        raycaster.setFromCamera(centerNdcRef.current, camera);
        const hits = raycaster.intersectObjects(targetMeshes, false);
        isHot = hits.length > 0;
        if (isHot) {
          const firstHit = hits[0];
          if (firstHit) {
            hoveredTargetId = (firstHit.object.userData.playerId as string | undefined) ?? null;
          }
        }
      }

      hoveredTargetIdRef.current = hoveredTargetId;

      if (isHot !== isCrosshairHotRef.current) {
        isCrosshairHotRef.current = isHot;
        setIsCrosshairHot(isHot);
      }

      if (rollInput !== 0 && worldRef.current.roomId) {
        syncLookRefsFromOrientation();
        sendLook();
      }

      for (const mesh of supplyCubeMeshesRef.current.values()) {
        mesh.rotation.x += 0.012;
        mesh.rotation.y += 0.018;
      }

      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(draw);
    };

    frameId = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
      for (const mesh of meshesRef.current.values()) {
        mesh.geometry.dispose();
        (mesh.material as MeshStandardMaterial).dispose();
      }
      meshesRef.current.clear();
      for (const mesh of projectileMeshesRef.current.values()) {
        mesh.geometry.dispose();
        (mesh.material as MeshStandardMaterial).dispose();
      }
      projectileMeshesRef.current.clear();
      for (const mesh of missileMeshesRef.current.values()) {
        mesh.geometry.dispose();
        (mesh.material as MeshStandardMaterial).dispose();
      }
      missileMeshesRef.current.clear();
      for (const mesh of explosionMeshesRef.current.values()) {
        mesh.geometry.dispose();
        (mesh.material as MeshStandardMaterial).dispose();
      }
      explosionMeshesRef.current.clear();
      for (const mesh of supplyCubeMeshesRef.current.values()) {
        mesh.geometry.dispose();
        (mesh.material as MeshStandardMaterial).dispose();
      }
      supplyCubeMeshesRef.current.clear();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
      threeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const threeContext = threeRef.current;
    if (!threeContext) {
      return;
    }

    const visiblePlayerIds = new Set<string>();
    for (const player of world.players) {
      if (player.id === playerId) {
        selfPositionRef.current.set(player.position.x, player.position.y, player.position.z);
        orientationRef.current.set(
          player.orientation.x,
          player.orientation.y,
          player.orientation.z,
          player.orientation.w
        );
        syncLookRefsFromOrientation();
        continue;
      }

      if (!player.isAlive) {
        continue;
      }

      visiblePlayerIds.add(player.id);
      let mesh = meshesRef.current.get(player.id);
      if (!mesh) {
        const geometry = new ConeGeometry(2.2, 6, 4);
        geometry.rotateX(-Math.PI / 2);
        const material = new MeshStandardMaterial({ color: player.color });
        mesh = new Mesh(geometry, material);
        mesh.userData.playerId = player.id;
        meshesRef.current.set(player.id, mesh);
        threeContext.scene.add(mesh);
      }

      mesh.position.set(player.position.x, player.position.y, player.position.z);
      mesh.quaternion.set(
        player.orientation.x,
        player.orientation.y,
        player.orientation.z,
        player.orientation.w
      );
    }

    for (const [id, mesh] of meshesRef.current.entries()) {
      if (visiblePlayerIds.has(id)) {
        continue;
      }

      threeContext.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
      meshesRef.current.delete(id);
    }

    const visibleProjectileIds = new Set<string>();
    for (const projectile of world.projectiles) {
      visibleProjectileIds.add(projectile.id);
      let mesh = projectileMeshesRef.current.get(projectile.id);
      if (!mesh) {
        mesh = new Mesh(
          new SphereGeometry(1.2, 12, 12),
          new MeshStandardMaterial({ color: "#e8f6ff", emissive: "#5bc0eb", emissiveIntensity: 1.2 })
        );
        projectileMeshesRef.current.set(projectile.id, mesh);
        threeContext.scene.add(mesh);
      }

      mesh.position.set(projectile.position.x, projectile.position.y, projectile.position.z);
    }

    for (const [id, mesh] of projectileMeshesRef.current.entries()) {
      if (visibleProjectileIds.has(id)) {
        continue;
      }

      threeContext.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
      projectileMeshesRef.current.delete(id);
    }

    const visibleMissileIds = new Set<string>();
    for (const missile of world.missiles) {
      visibleMissileIds.add(missile.id);
      let mesh = missileMeshesRef.current.get(missile.id);
      if (!mesh) {
        mesh = new Mesh(
          new CylinderGeometry(0.9, 0.9, 5.2, 14),
          new MeshStandardMaterial({ color: "#ff3d3d", emissive: "#8e0000", emissiveIntensity: 1.25 })
        );
        missileMeshesRef.current.set(missile.id, mesh);
        threeContext.scene.add(mesh);
      }

      mesh.position.set(missile.position.x, missile.position.y, missile.position.z);
      missileDirRef.current.set(missile.velocity.x, missile.velocity.y, missile.velocity.z).normalize();
      if (missileDirRef.current.lengthSq() > 0.00001) {
        mesh.quaternion.setFromUnitVectors(missileUpAxisRef.current, missileDirRef.current);
      }
    }

    for (const [id, mesh] of missileMeshesRef.current.entries()) {
      if (visibleMissileIds.has(id)) {
        continue;
      }

      threeContext.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
      missileMeshesRef.current.delete(id);
    }

    const visibleExplosionIds = new Set<string>();
    for (const explosion of world.explosions) {
      visibleExplosionIds.add(explosion.id);
      let mesh = explosionMeshesRef.current.get(explosion.id);
      if (!mesh) {
        mesh = new Mesh(
          new SphereGeometry(3.2, 14, 14),
          new MeshStandardMaterial({ color: "#ff9436", emissive: "#ff5d2d", emissiveIntensity: 1.8, transparent: true })
        );
        explosionMeshesRef.current.set(explosion.id, mesh);
        threeContext.scene.add(mesh);
      }

      const life = Math.max(0, Math.min(1, explosion.life));
      const scale = 0.5 + (1 - life) * 3.2;
      mesh.position.set(explosion.position.x, explosion.position.y, explosion.position.z);
      mesh.scale.set(scale, scale, scale);
      const material = mesh.material as MeshStandardMaterial;
      material.opacity = life * 0.85;
    }

    for (const [id, mesh] of explosionMeshesRef.current.entries()) {
      if (visibleExplosionIds.has(id)) {
        continue;
      }

      threeContext.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
      explosionMeshesRef.current.delete(id);
    }

    const visibleSupplyCubeIds = new Set<string>();
    for (const supplyCube of world.supplyCubes) {
      visibleSupplyCubeIds.add(supplyCube.id);
      let mesh = supplyCubeMeshesRef.current.get(supplyCube.id);
      if (!mesh) {
        mesh = new Mesh(new BoxGeometry(4.5, 4.5, 4.5), getSupplyCubeMaterialByType(supplyCube.cubeType));
        supplyCubeMeshesRef.current.set(supplyCube.id, mesh);
        threeContext.scene.add(mesh);
      }

      mesh.position.set(supplyCube.position.x, supplyCube.position.y, supplyCube.position.z);
    }

    for (const [id, mesh] of supplyCubeMeshesRef.current.entries()) {
      if (visibleSupplyCubeIds.has(id)) {
        continue;
      }

      threeContext.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
      supplyCubeMeshesRef.current.delete(id);
    }
  }, [playerId, world]);

  useEffect(() => {
    const onPointerLockChange = () => {
      const target = threeRef.current?.renderer.domElement;
      setIsPointerLocked(Boolean(target && document.pointerLockElement === target));
    };

    document.addEventListener("pointerlockchange", onPointerLockChange);
    return () => {
      document.removeEventListener("pointerlockchange", onPointerLockChange);
    };
  }, []);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!isPointerLocked || !worldRef.current.roomId) {
        return;
      }

      const yawAngle = -event.movementX * mouseSensitivity;
      const pitchAngle = -event.movementY * mouseSensitivity;

      qYawRef.current.setFromAxisAngle(localUpRef.current, yawAngle);
      qPitchRef.current.setFromAxisAngle(localRightRef.current, pitchAngle);
      orientationRef.current.multiply(qYawRef.current).multiply(qPitchRef.current).normalize();

      syncLookRefsFromOrientation();

      sendLook();
    };

    window.addEventListener("mousemove", onMouseMove);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
    };
  }, [isPointerLocked]);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 && event.button !== 2) {
        return;
      }

      if (!isPointerLocked || !worldRef.current.roomId) {
        return;
      }

      ensureAudioContext();

      if (event.button === 0) {
        sendMessage({ type: "shoot" });
        return;
      }

      const targetId = hoveredTargetIdRef.current;
      if (!targetId || !isCrosshairHotRef.current) {
        return;
      }

      sendMessage({
        type: "launch_homing",
        targetId,
      });
    };

    const onContextMenu = (event: MouseEvent) => {
      if (isPointerLocked) {
        event.preventDefault();
      }
    };

    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("contextmenu", onContextMenu);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("contextmenu", onContextMenu);
    };
  }, [isPointerLocked]);

  useEffect(() => {
    const sendInput = () => {
      if (!worldRef.current.roomId) {
        return;
      }

      const forward = (keyStateRef.current.w ? 1 : 0) + (keyStateRef.current.s ? -1 : 0);
      const strafe = (keyStateRef.current.d ? 1 : 0) + (keyStateRef.current.a ? -1 : 0);

      sendMessage({
        type: "input",
        forward,
        strafe,
      });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!["w", "a", "s", "d", "q", "e"].includes(key)) {
        return;
      }

      event.preventDefault();
      keyStateRef.current[key as "w" | "a" | "s" | "d" | "q" | "e"] = true;
      sendInput();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!["w", "a", "s", "d", "q", "e"].includes(key)) {
        return;
      }

      event.preventDefault();
      keyStateRef.current[key as "w" | "a" | "s" | "d" | "q" | "e"] = false;
      sendInput();
    };

    const pulseId = window.setInterval(sendInput, 250);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.clearInterval(pulseId);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

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
    if (connection !== "open") {
      return;
    }

    const intervalId = window.setInterval(() => {
      sendMessage({ type: "ping", sentAtMs: Date.now() });
    }, 1500);

    return () => window.clearInterval(intervalId);
  }, [connection]);

  const createRoom = () => {
    if (!roomName.trim()) {
      setErrorText("Enter room name");
      return;
    }

    setErrorText("");
    const sent = sendMessage({
      type: "create_room",
      roomName,
    });

    if (sent) {
      setRoomName("");
    }
  };

  const joinRoom = (roomId: string) => {
    setErrorText("");
    sendMessage({
      type: "join_room",
      roomId,
    });
  };

  const selfPlayer = world.players.find((player) => player.id === playerId);
  const selfHealth = selfPlayer?.health ?? 100;
  const selfMissileAmmo = selfPlayer?.missileAmmo ?? 5;
  const selfProjectileAmmo = selfPlayer?.projectileAmmo ?? 100;
  const isSelfDestroyed = Boolean(selfPlayer && !selfPlayer.isAlive);

  return (
    <main className="page">
      <h1>Cosmos Multiplayer</h1>
      <p>
        Status: <strong>{connection}</strong> | You: <strong>{playerId || "pending"}</strong> | Ping:
        <strong> {latencyMs} ms</strong>
      </p>
      <p>
        {world.roomId
          ? "Click 3D view to lock mouse. Move mouse to rotate. W/S fly forward/back, A/D strafe, Q/E roll, LMB shoot, RMB launch homing missile on red target."
          : "Create or join a room to start playing."}
      </p>
      <p>Mouse lock: {isPointerLocked ? "active" : "inactive"}</p>

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

      <section className="arena3d" aria-label="3D world">
        <div
          className="viewport3d"
          ref={containerRef}
          onClick={() => {
            ensureAudioContext();
            const rendererElement = threeRef.current?.renderer.domElement;
            if (rendererElement) {
              rendererElement.requestPointerLock();
            }
          }}
        >
          <div className={`crosshair ${isCrosshairHot ? "hot" : ""}`} aria-hidden="true" />
          {isSelfDestroyed ? <div className="death-overlay" aria-hidden="true" /> : null}
          {damageFlashId > 0 ? <div key={damageFlashId} className="damage-flash-overlay" aria-hidden="true" /> : null}
          <div className="hud-stats" aria-hidden="true">
            <div className="hud-stat-line">HP {Math.round(selfHealth)}</div>
            <div className="hud-stat-line">Rockets {selfMissileAmmo}</div>
            <div className="hud-stat-line">Shells {selfProjectileAmmo}</div>
          </div>
        </div>
      </section>
    </main>
  );
}

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { SupplyCubeType_t, WorldState_t } from "@cosmos/shared";
import { WORLD_HALF_EXTENT } from "@cosmos/shared";
import {
  AmbientLight,
  AxesHelper,
  BufferGeometry,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Euler,
  Float32BufferAttribute,
  GridHelper,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Quaternion,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";

const rollStepPerFrame = 0.02;
const starFieldCount = 2600;
const starFieldRadius = WORLD_HALF_EXTENT * 2.8;
const starFieldThickness = WORLD_HALF_EXTENT * 0.4;

type ThreeContext_t = {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
};

type UseThreeSceneArgs_t = {
  world: WorldState_t;
  worldRef: MutableRefObject<WorldState_t>;
  playerId: string;
  playerIdRef: MutableRefObject<string>;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  orientationRef: MutableRefObject<Quaternion>;
  selfPositionRef: MutableRefObject<Vector3>;
  localForwardRef: MutableRefObject<Vector3>;
  qRollRef: MutableRefObject<Quaternion>;
  keyStateRef: MutableRefObject<{ w: boolean; a: boolean; s: boolean; d: boolean; q: boolean; e: boolean }>;
  sendLook: () => void;
  syncLookRefsFromOrientation: () => void;
  getSupplyCubeMaterialByType: (cubeType: SupplyCubeType_t) => MeshStandardMaterial;
};

export const useThreeScene = ({
  world,
  worldRef,
  playerId,
  playerIdRef,
  containerRef,
  orientationRef,
  selfPositionRef,
  localForwardRef,
  qRollRef,
  keyStateRef,
  sendLook,
  syncLookRefsFromOrientation,
  getSupplyCubeMaterialByType,
}: UseThreeSceneArgs_t) => {
  const [isCrosshairHot, setIsCrosshairHot] = useState<boolean>(false);

  const threeRef = useRef<ThreeContext_t | null>(null);
  const meshesRef = useRef(new Map<string, Mesh>());
  const projectileMeshesRef = useRef(new Map<string, Mesh>());
  const missileMeshesRef = useRef(new Map<string, Mesh>());
  const explosionMeshesRef = useRef(new Map<string, Mesh>());
  const supplyCubeMeshesRef = useRef(new Map<string, Mesh>());
  const centerNdcRef = useRef(new Vector2(0, 0));
  const raycasterRef = useRef(new Raycaster());
  const isCrosshairHotRef = useRef(false);
  const hoveredTargetIdRef = useRef<string | null>(null);
  const missileUpAxisRef = useRef(new Vector3(0, 1, 0));
  const missileDirRef = useRef(new Vector3());

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const scene = new Scene();
    scene.background = new Color("#0b1220");

    const camera = new PerspectiveCamera(75, 1, 0.1, 8000);

    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    scene.add(new AmbientLight(0xffffff, 0.45));
    const directional = new DirectionalLight(0xffffff, 0.85);
    directional.position.set(60, 90, 40);
    scene.add(directional);

    scene.add(new GridHelper(WORLD_HALF_EXTENT * 2, 24, 0x3f5e8a, 0x1f2b45));
    scene.add(new AxesHelper(28));

    const starPositions = new Float32Array(starFieldCount * 3);
    for (let i = 0; i < starFieldCount; i += 1) {
      const theta = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const phi = Math.acos(u);
      const radius = starFieldRadius + (Math.random() * 2 - 1) * starFieldThickness;
      const sinPhi = Math.sin(phi);
      const index = i * 3;

      starPositions[index] = radius * sinPhi * Math.cos(theta);
      starPositions[index + 1] = radius * Math.cos(phi);
      starPositions[index + 2] = radius * sinPhi * Math.sin(theta);
    }

    const starGeometry = new BufferGeometry();
    starGeometry.setAttribute("position", new Float32BufferAttribute(starPositions, 3));
    const starMaterial = new PointsMaterial({
      color: "#cce8ff",
      size: 2.4,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.88,
    });
    const stars = new Points(starGeometry, starMaterial);
    scene.add(stars);

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
      scene.remove(stars);
      starGeometry.dispose();
      starMaterial.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
      threeRef.current = null;
    };
  }, [
    containerRef,
    keyStateRef,
    localForwardRef,
    orientationRef,
    playerIdRef,
    qRollRef,
    selfPositionRef,
    sendLook,
    syncLookRefsFromOrientation,
    worldRef,
  ]);

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
  }, [
    getSupplyCubeMaterialByType,
    orientationRef,
    playerId,
    selfPositionRef,
    syncLookRefsFromOrientation,
    world,
  ]);

  return {
    threeRef,
    isCrosshairHot,
    isCrosshairHotRef,
    hoveredTargetIdRef,
  };
};

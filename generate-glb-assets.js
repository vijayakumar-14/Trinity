import fs from 'fs';
import path from 'path';

/**
 * Procedural glTF 2.0 Binary (GLB) Generator for AERODRIFT 3D Assets
 * Constructs mathematically accurate 3D models with PBR materials,
 * normals, and indices aligned to the glTF 2.0 specification.
 */

class GlbBuilder {
  constructor() {
    this.primitives = [];
    this.materials = [];
  }

  addMaterial(name, baseColor, metallic = 0.1, roughness = 0.5) {
    const idx = this.materials.length;
    this.materials.push({
      name,
      pbrMetallicRoughness: {
        baseColorFactor: baseColor, // [r, g, b, a]
        metallicFactor: metallic,
        roughnessFactor: roughness
      },
      doubleSided: true
    });
    return idx;
  }

  addPrimitive(materialIndex, positions, normals, indices) {
    this.primitives.push({
      materialIndex,
      positions, // Array of [x, y, z]
      normals,   // Array of [nx, ny, nz]
      indices    // Array of integers
    });
  }

  build() {
    // Collect binary data
    const bufferParts = [];
    const bufferViews = [];
    const accessors = [];
    const meshes = [];

    let currentOffset = 0;

    const align4 = (n) => (n + 3) & ~3;

    const primitivesByMat = this.primitives;
    const meshPrimitives = [];

    primitivesByMat.forEach((prim, primIdx) => {
      // 1. Position bufferView and accessor
      const posArray = new Float32Array(prim.positions.flat());
      const posBytes = Buffer.from(posArray.buffer);
      const posOffset = currentOffset;
      bufferParts.push(posBytes);
      currentOffset += posBytes.length;

      // 4-byte align
      const posPad = align4(currentOffset) - currentOffset;
      if (posPad > 0) {
        bufferParts.push(Buffer.alloc(posPad));
        currentOffset += posPad;
      }

      const posViewIdx = bufferViews.length;
      bufferViews.push({
        buffer: 0,
        byteOffset: posOffset,
        byteLength: posBytes.length,
        target: 34962 // ARRAY_BUFFER
      });

      // Min and max for positions
      const minPos = [Infinity, Infinity, Infinity];
      const maxPos = [-Infinity, -Infinity, -Infinity];
      prim.positions.forEach(([x, y, z]) => {
        minPos[0] = Math.min(minPos[0], x);
        minPos[1] = Math.min(minPos[1], y);
        minPos[2] = Math.min(minPos[2], z);
        maxPos[0] = Math.max(maxPos[0], x);
        maxPos[1] = Math.max(maxPos[1], y);
        maxPos[2] = Math.max(maxPos[2], z);
      });

      const posAccIdx = accessors.length;
      accessors.push({
        bufferView: posViewIdx,
        byteOffset: 0,
        componentType: 5126, // FLOAT
        count: prim.positions.length,
        type: "VEC3",
        min: minPos,
        max: maxPos
      });

      // 2. Normal bufferView and accessor
      const normArray = new Float32Array(prim.normals.flat());
      const normBytes = Buffer.from(normArray.buffer);
      const normOffset = currentOffset;
      bufferParts.push(normBytes);
      currentOffset += normBytes.length;

      const normPad = align4(currentOffset) - currentOffset;
      if (normPad > 0) {
        bufferParts.push(Buffer.alloc(normPad));
        currentOffset += normPad;
      }

      const normViewIdx = bufferViews.length;
      bufferViews.push({
        buffer: 0,
        byteOffset: normOffset,
        byteLength: normBytes.length,
        target: 34962 // ARRAY_BUFFER
      });

      const normAccIdx = accessors.length;
      accessors.push({
        bufferView: normViewIdx,
        byteOffset: 0,
        componentType: 5126, // FLOAT
        count: prim.normals.length,
        type: "VEC3"
      });

      // 3. Index bufferView and accessor
      const idxArray = new Uint16Array(prim.indices);
      const idxBytes = Buffer.from(idxArray.buffer);
      const idxOffset = currentOffset;
      bufferParts.push(idxBytes);
      currentOffset += idxBytes.length;

      const idxPad = align4(currentOffset) - currentOffset;
      if (idxPad > 0) {
        bufferParts.push(Buffer.alloc(idxPad));
        currentOffset += idxPad;
      }

      const idxViewIdx = bufferViews.length;
      bufferViews.push({
        buffer: 0,
        byteOffset: idxOffset,
        byteLength: idxBytes.length,
        target: 34963 // ELEMENT_ARRAY_BUFFER
      });

      const idxAccIdx = accessors.length;
      accessors.push({
        bufferView: idxViewIdx,
        byteOffset: 0,
        componentType: 5123, // UNSIGNED_SHORT
        count: prim.indices.length,
        type: "SCALAR",
        min: [0],
        max: [prim.positions.length - 1]
      });

      meshPrimitives.push({
        attributes: {
          POSITION: posAccIdx,
          NORMAL: normAccIdx
        },
        indices: idxAccIdx,
        material: prim.materialIndex
      });
    });

    meshes.push({
      name: "AerospaceAssembly",
      primitives: meshPrimitives
    });

    const gltfJson = {
      asset: { version: "2.0", generator: "AERODRIFT Aerospace Asset Engine" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, name: "RootAssembly" }],
      meshes: meshes,
      materials: this.materials,
      buffers: [{ byteLength: currentOffset }],
      bufferViews: bufferViews,
      accessors: accessors
    };

    const jsonStr = JSON.stringify(gltfJson);
    let jsonBuffer = Buffer.from(jsonStr, 'utf8');
    const jsonPad = align4(jsonBuffer.length) - jsonBuffer.length;
    if (jsonPad > 0) {
      jsonBuffer = Buffer.concat([jsonBuffer, Buffer.from(" ".repeat(jsonPad), 'utf8')]);
    }

    const binBuffer = Buffer.concat(bufferParts);

    // Assemble final GLB: Header (12 bytes) + JSON Chunk + BIN Chunk
    const totalLength = 12 + 8 + jsonBuffer.length + 8 + binBuffer.length;
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546C67, 0); // 'glTF'
    header.writeUInt32LE(2, 4);          // version 2
    header.writeUInt32LE(totalLength, 8); // total length

    const jsonHeader = Buffer.alloc(8);
    jsonHeader.writeUInt32LE(jsonBuffer.length, 0);
    jsonHeader.writeUInt32LE(0x4E4F534A, 4); // 'JSON'

    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(binBuffer.length, 0);
    binHeader.writeUInt32LE(0x004E4942, 4); // 'BIN\0'

    return Buffer.concat([header, jsonHeader, jsonBuffer, binHeader, binBuffer]);
  }
}

// Geometry helper: Create UV sphere / prolate teardrop for balloon envelope
function createBalloonEnvelope(radius = 1.6, vScale = 1.2, segH = 24, segV = 16) {
  const positions = [];
  const normals = [];
  const indices = [];

  for (let lat = 0; lat <= segV; lat++) {
    const theta = (lat * Math.PI) / segV; // 0 to PI
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    // Teardrop neck taper at bottom
    const neckFactor = 1.0 - 0.25 * Math.pow(lat / segV, 2.5);

    for (let lon = 0; lon <= segH; lon++) {
      const phi = (lon * 2 * Math.PI) / segH;
      const x = radius * sinTheta * Math.cos(phi) * neckFactor;
      const y = radius * sinTheta * Math.sin(phi) * neckFactor;
      // Centered at Z, shifted upward so payload hangs below Z=0
      const z = radius * cosTheta * vScale + 1.2;

      positions.push([x, y, z]);

      // Approximate normal
      const len = Math.hypot(x, y, z - 1.2) || 1;
      normals.push([x / len, y / len, (z - 1.2) / len]);
    }
  }

  for (let lat = 0; lat < segV; lat++) {
    for (let lon = 0; lon < segH; lon++) {
      const first = lat * (segH + 1) + lon;
      const second = first + segH + 1;

      indices.push(first, second, first + 1);
      indices.push(second, second + 1, first + 1);
    }
  }

  return { positions, normals, indices };
}

// Geometry helper: Create box/cuboid
function createBox(cx, cy, cz, wx, wy, wz) {
  const hx = wx / 2, hy = wy / 2, hz = wz / 2;
  const positions = [];
  const normals = [];
  const indices = [];

  const faces = [
    { n: [0, 0, 1], p: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
    { n: [0, 0, -1], p: [[-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz], [-hx, -hy, -hz]] },
    { n: [0, 1, 0], p: [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]] },
    { n: [0, -1, 0], p: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]] },
    { n: [1, 0, 0], p: [[hx, -hy, -hz], [hx, -hy, hz], [hx, hy, hz], [hx, hy, -hz]] },
    { n: [-1, 0, 0], p: [[-hx, -hy, -hz], [-hx, hy, -hz], [-hx, hy, hz], [-hx, -hy, hz]] },
  ];

  faces.forEach(f => {
    const base = positions.length;
    f.p.forEach(([x, y, z]) => {
      positions.push([x + cx, y + cy, z + cz]);
      normals.push(f.n);
    });
    indices.push(base, base + 1, base + 2);
    indices.push(base, base + 2, base + 3);
  });

  return { positions, normals, indices };
}

// Geometry helper: Create cylinder or line harness
function createCylinder(x1, y1, z1, x2, y2, z2, radius = 0.02, seg = 8) {
  const positions = [];
  const normals = [];
  const indices = [];

  const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
  const len = Math.hypot(dx, dy, dz) || 1;
  const dir = [dx / len, dy / len, dz / len];

  // Up vector
  let up = Math.abs(dir[2]) < 0.99 ? [0, 0, 1] : [1, 0, 0];
  // Orthogonal basis
  const right = [
    dir[1] * up[2] - dir[2] * up[1],
    dir[2] * up[0] - dir[0] * up[2],
    dir[0] * up[1] - dir[1] * up[0]
  ];
  const rLen = Math.hypot(...right) || 1;
  right[0] /= rLen; right[1] /= rLen; right[2] /= rLen;

  const perp = [
    dir[1] * right[2] - dir[2] * right[1],
    dir[2] * right[0] - dir[0] * right[2],
    dir[0] * right[1] - dir[1] * right[0]
  ];

  for (let i = 0; i <= seg; i++) {
    const angle = (i * 2 * Math.PI) / seg;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const ox = (right[0] * cos + perp[0] * sin) * radius;
    const oy = (right[1] * cos + perp[1] * sin) * radius;
    const oz = (right[2] * cos + perp[2] * sin) * radius;

    positions.push([x1 + ox, y1 + oy, z1 + oz]);
    normals.push([ox / radius, oy / radius, oz / radius]);

    positions.push([x2 + ox, y2 + oy, z2 + oz]);
    normals.push([ox / radius, oy / radius, oz / radius]);
  }

  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, b, c);
    indices.push(b, d, c);
  }

  return { positions, normals, indices };
}

// Geometry helper: Parachute canopy (inverted hemisphere)
function createParachuteCanopy(radius = 0.9, cz = -1.2, segH = 20, segV = 10) {
  const positions = [];
  const normals = [];
  const indices = [];

  for (let lat = 0; lat <= segV; lat++) {
    const theta = (lat * (Math.PI / 2.2)) / segV; // Dome
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let lon = 0; lon <= segH; lon++) {
      const phi = (lon * 2 * Math.PI) / segH;
      const x = radius * sinTheta * Math.cos(phi);
      const y = radius * sinTheta * Math.sin(phi);
      const z = radius * cosTheta + cz;

      positions.push([x, y, z]);
      // Normal points outward/upward
      const len = Math.hypot(x, y, z - cz) || 1;
      normals.push([x / len, y / len, (z - cz) / len]);
    }
  }

  for (let lat = 0; lat < segV; lat++) {
    for (let lon = 0; lon < segH; lon++) {
      const first = lat * (segH + 1) + lon;
      const second = first + segH + 1;
      indices.push(first, second, first + 1);
      indices.push(second, second + 1, first + 1);
    }
  }

  return { positions, normals, indices };
}

function mergeGeometries(geomList) {
  const positions = [];
  const normals = [];
  const indices = [];

  geomList.forEach(g => {
    const base = positions.length;
    positions.push(...g.positions);
    normals.push(...g.normals);
    g.indices.forEach(idx => indices.push(base + idx));
  });

  return { positions, normals, indices };
}

// -------------------------------------------------------------
// 1. BUILD BALLOON ASSEMBLY GLB (Intact Balloon + Rigging + Payload)
// -------------------------------------------------------------
function buildBalloonAssemblyGlb() {
  const builder = new GlbBuilder();

  // Materials
  const matLatex = builder.addMaterial("LatexEnvelope", [0.96, 0.95, 0.90, 0.95], 0.05, 0.3); // Milky latex
  const matNylon = builder.addMaterial("RiggingLines", [0.75, 0.75, 0.75, 1.0], 0.1, 0.8);    // Spectra cords
  const matPayload = builder.addMaterial("AvionicsPod", [0.88, 0.92, 0.86, 1.0], 0.2, 0.4);  // Insulated pod
  const matChuteStowed = builder.addMaterial("ChuteStowed", [0.95, 0.38, 0.12, 1.0], 0.05, 0.6); // Safety orange
  const matAntenna = builder.addMaterial("AntennaMetal", [0.2, 0.8, 0.9, 1.0], 0.9, 0.1);     // Metallic probe

  // 1. Balloon Envelope
  const balloon = createBalloonEnvelope(1.5, 1.25);
  builder.addPrimitive(matLatex, balloon.positions, balloon.normals, balloon.indices);

  // 2. Flight train cords: From balloon neck (Z = -0.5) down through stowed chute to payload
  const lines = [];
  const neckZ = -0.4;
  const chuteZ = -1.5;
  const payloadZ = -2.8;

  // 4 rigging cords
  const offsets = [
    [0.15, 0.15],
    [-0.15, 0.15],
    [-0.15, -0.15],
    [0.15, -0.15]
  ];

  offsets.forEach(([ox, oy]) => {
    lines.push(createCylinder(0, 0, neckZ, ox, oy, chuteZ, 0.012));
    lines.push(createCylinder(ox, oy, chuteZ, ox * 0.8, oy * 0.8, payloadZ, 0.012));
  });

  const mergedLines = mergeGeometries(lines);
  builder.addPrimitive(matNylon, mergedLines.positions, mergedLines.normals, mergedLines.indices);

  // 3. Stowed parachute pack (cylindrical bundle in middle of flight train)
  const stowedPack = createCylinder(0, 0, chuteZ + 0.15, 0, 0, chuteZ - 0.15, 0.12, 12);
  builder.addPrimitive(matChuteStowed, stowedPack.positions, stowedPack.normals, stowedPack.indices);

  // 4. Avionics CubeSat Payload Pod
  const pod = createBox(0, 0, payloadZ - 0.2, 0.4, 0.3, 0.35);
  builder.addPrimitive(matPayload, pod.positions, pod.normals, pod.indices);

  // 5. Sensor boom & radio whip antenna
  const antenna = mergeGeometries([
    createCylinder(0, 0, payloadZ - 0.38, 0, 0, payloadZ - 0.9, 0.008), // Whip antenna pointing down
    createCylinder(0.2, 0, payloadZ - 0.2, 0.5, 0, payloadZ - 0.2, 0.01) // Pitot probe forward
  ]);
  builder.addPrimitive(matAntenna, antenna.positions, antenna.normals, antenna.indices);

  return builder.build();
}

// -------------------------------------------------------------
// 2. BUILD PARACHUTE DESCENT GLB (Deployed Chute + Suspension + Payload)
// -------------------------------------------------------------
function buildParachuteDescentGlb() {
  const builder = new GlbBuilder();

  // Materials
  const matCanopy = builder.addMaterial("ParachuteCanopy", [0.95, 0.35, 0.12, 1.0], 0.05, 0.7); // Aviation orange
  const matLines = builder.addMaterial("ShroudLines", [0.85, 0.85, 0.85, 1.0], 0.1, 0.8);
  const matPayload = builder.addMaterial("AvionicsPod", [0.88, 0.92, 0.86, 1.0], 0.2, 0.4);
  const matAntenna = builder.addMaterial("AntennaMetal", [0.2, 0.8, 0.9, 1.0], 0.9, 0.1);

  // 1. Deployed Hemispherical Canopy
  const canopyZ = 0.5;
  const canopy = createParachuteCanopy(1.2, canopyZ, 24, 12);
  builder.addPrimitive(matCanopy, canopy.positions, canopy.normals, canopy.indices);

  // 2. Shroud Lines radiating from canopy hem down to bridle ring
  const lines = [];
  const bridleZ = -1.0;
  const payloadZ = -1.8;
  const numLines = 8;
  for (let i = 0; i < numLines; i++) {
    const angle = (i * 2 * Math.PI) / numLines;
    const hx = 1.2 * Math.cos(angle);
    const hy = 1.2 * Math.sin(angle);
    lines.push(createCylinder(hx, hy, canopyZ, 0, 0, bridleZ, 0.01));
  }
  // Bridle to payload
  lines.push(createCylinder(0, 0, bridleZ, 0, 0, payloadZ, 0.015));

  const mergedLines = mergeGeometries(lines);
  builder.addPrimitive(matLines, mergedLines.positions, mergedLines.normals, mergedLines.indices);

  // 3. Avionics Payload Pod
  const pod = createBox(0, 0, payloadZ - 0.2, 0.4, 0.3, 0.35);
  builder.addPrimitive(matPayload, pod.positions, pod.normals, pod.indices);

  // 4. Whip antenna & probe
  const antenna = mergeGeometries([
    createCylinder(0, 0, payloadZ - 0.38, 0, 0, payloadZ - 0.9, 0.008),
    createCylinder(0.2, 0, payloadZ - 0.2, 0.5, 0, payloadZ - 0.2, 0.01)
  ]);
  builder.addPrimitive(matAntenna, antenna.positions, antenna.normals, antenna.indices);

  return builder.build();
}

const outDir = path.resolve('assets');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const balloonGlb = buildBalloonAssemblyGlb();
fs.writeFileSync(path.join(outDir, 'balloon_assembly.glb'), balloonGlb);
console.log(`[GLB GENERATED] assets/balloon_assembly.glb (${balloonGlb.length} bytes)`);

const chuteGlb = buildParachuteDescentGlb();
fs.writeFileSync(path.join(outDir, 'parachute_descent.glb'), chuteGlb);
console.log(`[GLB GENERATED] assets/parachute_descent.glb (${chuteGlb.length} bytes)`);

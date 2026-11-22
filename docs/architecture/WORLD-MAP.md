# Strategic world map architecture

## Recommendation

Build a **2.5D board-like world in 3D**, not a flat image and not an unrestricted
open-world terrain.

The audited legacy `wotr` world is a useful authored source candidate for
geography, ownership, locations and registration. Its publication license is not
yet established, so it may guide planning but cannot be copied into a release or
this repository until authorized. It should not become the final map image by
itself, and it should not be converted into one enormous hand-made mesh. The
robust pipeline is data-driven:

```text
reference/albedo + heightmap + biome masks + water/river masks
                    ↓
       chunked terrain mesh and materials
                    ↓
 landmarks, roads, fog, weather, armies, interaction overlays
```

A constrained orthographic/low-perspective camera keeps the readability of a
strategy board while real height, shadows, water, animated landmarks, fog, and
weather provide the visual improvement over the 2004 map.

## Why not the two extremes

### Flat image only

It is fast, but cannot deliver convincing parallax, lighting, animated
landmarks, height-aware routes, weather, or a modern camera. It would reproduce
the main limitation we are trying to remove.

### Fully free 3D world

It adds cost without adding strategic value: distant geometry, arbitrary
camera angles, complex occlusion, terrain collision, and excessive art detail.
It also makes borders and movement harder to read. WOTR needs a beautiful board,
not a second tactical map.

## Legacy reference

The source reference is `Creative36711/wotr` commit
`fd12e3a3a52ad485f95af3ff559610fd2778570b`:

- `public/templates/map.jpg`: 5120 × 4096;
- pointy axial grid with 72-pixel radius and origin `(36, 36)`;
- 1,412 authored cells: 541 water and 871 land/passable candidates;
- terrain tags for plains, mountains, hills, forest, swamp, snow, and desert;
- 186 locations, 24 regions, 125 domains, 61 strongholds and 13 armies;
- 51 RTS-enabled locations; all audited tactical entries declare eight starts;
- A* movement, roads/rivers/fords/bridges, fog, reachability, ownership and region data.

The accepted path is a versioned one-way importer (ADR-002), not a runtime
React/Tauri dependency. It maps explicit legacy identifiers through an
append-only stable-ID table, validates topology/ownership/references, emits
canonical Campaign Pack data and a source/hash/loss report. DOM/SVG/Canvas,
Tauri, Win32 click/OCR automation and external retail processes are not ported.
The image, generated dataset and `__wotr_maps.big` are not published until the
Master records their license/provenance authorization; clean-room fixtures prove
the importer meanwhile.

## Canonical layers

The visual map and strategic rules must not be one data blob.

1. **Geography** — immutable projection, coast/water, height, biome, landmark
   anchors.
2. **Navigation** — axial hex IDs, passability, integer movement costs,
   neighbour graph, roads, rivers, crossings.
3. **Political topology** — provinces/regions and ownership; independent of the
   terrain mesh and able to change during play.
4. **Campaign state** — armies, heroes, structures, resources, orders, fog,
   scripted events.
5. **Presentation** — selection, routes, banners, particles, labels, weather,
   camera and animation.

C++ owns layers 2–4. Godot resources import geography and render all layers,
but submit commands rather than mutating campaign state directly.

## Hexes in a 3D scene

Keep the existing pointy axial coordinate model:

```text
id = "q:r"
neighbours = (+1,0), (+1,-1), (0,-1), (-1,0), (-1,+1), (0,+1)
```

At import time, map each axial centre to world X/Z and sample terrain height for
Y. At runtime:

- screen input raycasts to the terrain;
- world X/Z converts deterministically to axial q/r;
- C++ pathfinding works only on integer cell data;
- Godot renders a height-following route spline and optional projected hex
  overlay;
- physics/navmeshes never decide strategic movement.

Hex borders should normally be invisible. Show selected, reachable, blocked,
or editor cells as a projected shader/decal overlay. Provinces remain visually
organic and may contain many hexes.

## Terrain representation

Start with a 16- or 32-bit heightmap and split the map into fixed chunks. Each
chunk has deterministic bounds and LOD. Recommended first budgets:

- 8×8 or 16×16 chunks;
- 2–3 terrain LOD levels;
- one shared terrain material with biome splat/control maps;
- water as a separate plane/mask;
- vegetation and repeated props through `MultiMeshInstance3D`;
- landmarks as separate GLB scenes with low/medium LOD;
- no runtime terrain collision finer than selection requires.

The reference image can be projected as the first albedo so a playable map
exists immediately. It is then replaced progressively by authored material
masks and detail textures without changing coordinates or game logic.

## Visual quality target

To meet or exceed the original WOTR presentation, the first production slice
must demonstrate all of these together:

- terrain relief and stable readable camera;
- animated water/cloud/fog layer;
- one animated landmark (for example Orthanc or Barad-dûr);
- faction ownership tint without destroying terrain colour;
- a 3D army/banner marker anchored to terrain;
- hover/select/reachable/path overlays;
- smooth zoom from whole-world view to a province;
- stable frame pacing on the agreed minimum GPU and a degraded SwiftShader
  smoke-test mode.

## Phased implementation

### M0 — registration prototype

Run the one-way importer on a small clean-room fixture (or an explicitly
authorized source subset), use a generated low-resolution heightfield, and prove
raycast → stable axial cell → C++ path → 3D route. Do not copy the legacy image
or full dataset merely to make the prototype convenient.

### M1 — vertical slice

Finish one corridor (for example Isengard–Rohan–Gondor) with materials, water,
three landmarks, army markers, selection, movement, and one tactical battle
round-trip. This decides the art direction before modelling the whole continent.

### M2 — authored world

Complete control maps, landmarks, region overlays, fog/weather, editor tools,
and LOD/performance budgets.

### M3 — campaign integration

Connect economy, structures, heroes, AI, turn phases, save/migration, and LAN
state replication to the finished map view.

## Blender's role

Use Blender/bpy to generate and validate terrain chunks, landmarks, rigs, and
GLB exports. Use Godot to author final materials, lighting, particles, weather,
and screenshots. Do not try to render the map in Blender inside Arena; the
sandbox pipeline deliberately renders through Godot/SwiftShader.

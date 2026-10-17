# Architecture: what's core and what's view-specific

The app is built in layers so the pet itself (its needs, personality, learning and behaviour) doesn't depend on how it's drawn. Today the main view is 2D and side-on. A real 3D version can be added later by writing a new **space** and a new **renderer**. The core layers stay as they are.

```
 ┌──────────────────────────────────────────────────────────────────────┐
 │ Page (main.js): creator, buttons, side panel, pointer → world calls  │
 ├──────────────────────────────────────────────────────────────────────┤
 │ Views: renderer.js + pet-art.js + owner-art.js + finds-art.js (2D)   │  replace or add
 │        scene3d.js (3D preview)                                       │  for 3D
 ├──────────────────────────────────────────────────────────────────────┤
 │ Space: space-side.js, where things are and how they move             │  replace for 3D
 │        (positions, walking, physics, leash, hit tests)               │
 ├──────────────────────────────────────────────────────────────────────┤
 │ Behaviour: world.js, activities, decisions, reactions to the owner,  │  unchanged
 │        learning and hearts hooks (asks the space questions)          │
 ├──────────────────────────────────────────────────────────────────────┤
 │ Core: pet.js, learning.js, bond.js, finds.js, commands.js,           │  unchanged
 │        owner-look.js, sound.js, media-store.js                       │
 └──────────────────────────────────────────────────────────────────────┘
```

## Every file, and whether 3D would change it

| File | What it is | Changes for 3D? |
| --- | --- | --- |
| `pet.js` | Needs, personality, saving, catching up after time away | No |
| `learning.js` | Tricks, words, routines, habits | No |
| `bond.js` | Hearts, daily caps, bond levels, unlocks | No |
| `finds.js` | What can be found on walks, the collection | No |
| `commands.js` | Understanding what you type or say | No |
| `owner-look.js` | Your look options (hair, skin, clothes) | No, but 3D may add options |
| `sound.js`, `media-store.js` | Voices, photos and clips | No |
| `world.js` | The pet's behaviour: every activity, how it chooses, how it reacts to you | **No.** It asks the space instead of using coordinates |
| `space-side.js` | Where things are and how they move in the side-on room | **Replaced** by a 3D space |
| `renderer.js`, `pet-art.js`, `owner-art.js`, `finds-art.js` | 2D drawing | Kept for the 2D view; not used by 3D |
| `scene3d.js` | 3D drawing (preview) | **Rewritten** around the 3D space and better assets |
| `main.js` | Page wiring and pointer input | **Small changes:** pointer → 3D picking, and choosing the space |

## The space contract

The behaviour never touches coordinates. It asks the space. The full list is `SPACE_CONTRACT` in `world.js`, and a test fails if a space is missing any of it. In plain words:

| Question or action | Side-on answer today | What a 3D space would do |
| --- | --- | --- |
| `approach(target, gap, gait)`: go and stand next to something, facing it | Moves along x to `gap` from the target | Path-find across the floor, avoiding furniture |
| `goTo(target, gait)`, `stop()`, `face()`, `faceAway()`, `turnAround()` | Moves and flips left or right | Moves on the floor plane with a heading angle |
| `near(target, dist)` | Distance along x | Distance on the floor |
| `placeOf('bowl' / 'bed' / 'bag' / 'jar')`, `wanderSpot()`, `farSide()` | Fixed x positions | Positions from the room's layout, which a home designer can change |
| `ownerSpot()`, `sideOfOwner()`, `besideOwner()` | Left or right of the owner | A spot around the owner |
| `headPoint()`, `mouthPoint()`, `atMouth()` | Estimated from the 2D drawing's proportions | Read from the model's head bone |
| `heldHigh(point)`, `heldLow(point)` (lure training) | Treat height versus head height | Same idea in 3D |
| `launchBall()`, `ballLanding()`, `shouldLeap()`, `canGrab()`, `batBall()`, `dropBall()`, `lobBallTo()` | Hand-written 2D ball physics | A physics engine (for example Rapier) with real collisions |
| `dropTreat()`, `overBowl()` | 2D positions | 3D positions |
| `hitTest()`, `reachFor()`, `walkOwnerTo()` | What the pointer is over; the owner walks to reach | Raycasting onto models and furniture |
| `placeAtHome()`, `placeForWalk()`, `placeBackHome()` | Starting positions | Spawn points in the room or on the walk |
| `walkedMeters()`, `spawnFind()`, `scheduleFind()`, `spawnCritter()` | Along the path | Along a route, which could come from a real map |
| `moveOwner()`, `moveBody()`, `holdLeash()`, `moveBall()`, `moveFloorTreat()`, `moveParticles()` | One step of movement each frame | The same, in 3D |

Distances the behaviour passes (`gap`, `dist`) are in pet-sized units: the space multiplies them by the pet's scale. Each space can then use its own units (view units here, metres in 3D) without the behaviour caring.

## Checklist for a real 3D version

1. **Pick the engine and assets.** Either stay on the web (three.js or Babylon.js, plus Rapier physics), or move to Unity or Godot. Budget for realistic dog and cat models with full animation sets, and use free realistic people such as Microsoft Rocketbox. (Unity would mean rewriting the code in C#, but this layering and the contract still apply.)
2. **Write `space-3d.js`** implementing every method in `SPACE_CONTRACT` over a 3D room: floor positions, a heading angle instead of left or right, furniture with collision shapes, and physics for the ball. Then `class World3D extends World {}` and mix the 3D space into it, the same way `space-side.js` is mixed into `World`.
3. **Store the room as data** (furniture, positions, sizes). `placeOf()` reads from it, and that same data is what a "design your home" feature edits.
4. **Rewrite `scene3d.js`** to draw the 3D space, map the behaviour's poses (sit, lie, wag, paw...) to animation clips, and pick objects with the pointer.
5. **Update `main.js`** to create `World3D` and route pointer input through 3D picking.
6. Run the tests. The core and behaviour tests should pass unchanged; add tests for the new space.

## Known couplings that remain

These are small, but worth knowing before the 3D work:

- **Facing is left or right** (`body.dir` is 1 or -1). A 3D space would add a heading angle. The behaviour only changes facing through `face()`, `faceAway()` and `turnAround()`, so the change stays inside the space and renderers.
- **Points are objects with x and y** (y pointing down, in view units). The behaviour only passes them along (the hand's position, where effects appear, where a gift lies), so a 3D space can give them a z as well.
- **Pointer input arrives in the space's coordinates.** `main.js` converts screen positions; for 3D that conversion is `scene3d.pick()`.
- **Effects and speech bubbles** are positioned in view units; a 3D renderer projects them onto the screen, as `scene3d.drawOverlay()` already does.

## Tests that guard the line

`test/architecture.test.js` fails if:

- a core file imports anything outside the core,
- `world.js` mentions coordinates (`GROUND`, `BOWL_X`, and so on) or imports drawing code,
- the side-on space is missing a method from `SPACE_CONTRACT`.

# Asset credits and licences

Every model and animation here is free to use, including commercially.

| File | What | By | Licence |
| --- | --- | --- | --- |
| `models/shiba.glb`, `models/husky.glb` | Animated Shiba Inu and Husky: idle, walk, gallop, eat, sniff, jump, lie down and more | [Quaternius](https://quaternius.com), from *LowPoly Animated Animals* ([poly.pizza bundle](https://poly.pizza/bundle/Animated-Animal-Pack-ILAPXeUYiS)) | CC0 |
| `models/cat.glb` | “Toon Cat FREE”, a single walk cycle | [Omabuarts Studio](https://sketchfab.com/omabuarts) ([model page](https://sketchfab.com/3d-models/toon-cat-free-b2bd1ee7858444bda366110a2d960386)) | [CC-BY 4.0](http://creativecommons.org/licenses/by/4.0/): credit required |
| `models/owner/mannequin.glb` | KayKit neutral mannequin, `Rig_Medium` skeleton | [Kay Lousberg](https://www.kaylousberg.com), KayKit Character Animations | CC0 |
| `models/owner/anim-*.glb` | KayKit Character Animations: idle, walk, run, throw, pick up, use item, interact, crouch, sit and lie on the floor, wave, cheer and more | [Kay Lousberg](https://www.kaylousberg.com) | CC0 |
| `../vendor/three/` | three.js r185 | three.js authors | MIT |

Required credit for the cat:

> This work is based on “Toon Cat FREE” (https://sketchfab.com/3d-models/toon-cat-free-b2bd1ee7858444bda366110a2d960386) by Omabuarts Studio (https://sketchfab.com/omabuarts), licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/).

## Where the files came from

This project's build environment could only reach GitHub, so the files were taken from public repositories that redistribute them:

- Dogs: `public/models/dog-*.glb` in [teuzowebdeveloper9/world-light](https://github.com/teuzowebdeveloper9/world-light). That project's own licence is non-commercial, but it states that third-party CC0 assets keep their own licences. Before a commercial release, download the originals from Quaternius (poly.pizza or itch.io) to be safe.
- Cat: `assets/models/toon_cat_free.glb` in [DevTakao/threejs-cat](https://github.com/DevTakao/threejs-cat), which includes the original licence file.
- Mannequin and animations: [NoLimitNexus/game-models](https://github.com/NoLimitNexus/game-models) (`tools/reference/Mannequin_Medium.glb` and `library/animations/Rig_Medium_*.glb`), which includes KayKit's licence. That repository's own body and clothing parts have no licence, so they are **not** used here.

## Map blocks

The rules for turning OpenStreetMap features into blocks in `src/blocks.js` (which material each kind of land, road and surface becomes, and how wide each kind of road is) follow [Arnis](https://github.com/louis-e/arnis) by Louis Erbkamm and contributors, licensed under the [Apache License 2.0](https://github.com/louis-e/arnis/blob/main/LICENSE). No Arnis code is copied; the rules are re-expressed in JavaScript.

// Guards the line between the pet's core (needs, learning, behaviour) and
// the space and views it is drawn in, so a 3D version can be added later by
// writing a new space and renderer without touching the core.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SPACE_CONTRACT } from '../src/world.js';
import { sideSpace } from '../src/space-side.js';

const read = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const imports = (src) => [...src.matchAll(/from '\.\/([^']+)'/g)].map((m) => m[1]);

const CORE = ['pet.js', 'learning.js', 'bond.js', 'finds.js', 'commands.js', 'owner-look.js', 'route.js'];
const VIEW_ONLY = ['renderer.js', 'pet-art.js', 'owner-art.js', 'finds-art.js', 'scene3d.js', 'space-side.js', 'main.js'];

test('core modules depend only on other core modules', () => {
  for (const f of CORE) {
    for (const dep of imports(read(f))) {
      assert.ok(CORE.includes(dep), `${f} imports ${dep}, which is not core`);
    }
  }
});

test('behaviour uses no coordinates and no drawing code', () => {
  const src = read('world.js');
  for (const dep of imports(src)) {
    assert.ok([...CORE, 'space-side.js'].includes(dep), `world.js imports ${dep}`);
    assert.ok(!VIEW_ONLY.includes(dep) || dep === 'space-side.js', `world.js imports view code ${dep}`);
  }
  for (const word of ['GROUND', 'BOWL_X', 'BED_X', 'MIN_X', 'MAX_X', 'UNITS_PER_METER', 'GRAVITY', 'VIEW_W']) {
    assert.ok(!src.includes(word), `world.js mentions ${word}; ask the space instead`);
  }
});

test('the side-on space provides everything the behaviour needs', () => {
  for (const name of SPACE_CONTRACT) {
    assert.equal(typeof sideSpace[name], 'function', `space-side.js is missing ${name}()`);
  }
});

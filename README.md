# AI Pet

A virtual cat or dog that behaves like a real one. It gets hungry, tired and bored on a real clock, has its own personality, and learns from how you treat it. No fur on the sofa, no chewed furniture (yet).

## 2D, with a 3D preview

The app runs in 2D. A **Try 3D (preview)** button shows the same simulation drawn in 3D (three.js) with free animated models: a Shiba Inu or Husky, a cat, and you as a KayKit character. The free models aren't good enough for the main view yet. See `docs/architecture.md` for how the code is layered so a proper 3D version can be added later without changing the pet's core.

- The models come with animation libraries (the dogs: idle, walk, gallop, eat, sniff, jump, lie down; the owner: walk, throw, pick up, use item, crouch, wave, cheer, sit on the floor and more). The app picks the clip that matches what the pet or owner is doing.
- Poses the libraries lack are made by turning bones on top of the animation: sitting, the play bow, shaking a paw, tail wagging, ears and a head tilt.
- See `assets/CREDITS.md` for every model's source and licence. The cat is CC-BY 4.0 and must be credited.

## What you can do

Everything happens with your hands in the scene. You appear there as a character you design yourself.

- **Create your pet**: dog or cat, size, ears, coat colour, markings, eyes, collar, name, and four personality traits: energy, playfulness, cuddliness and stubbornness.
- **Create yourself**: hair style and colour, skin tone, top and trousers. You walk over, crouch and reach to do things.
- **Feed**: press the food bag to take a scoop, then hold it over the bowl to pour. You decide how much goes in.
- **Treats and lure training**: take a treat from the jar. Hold it up high and your pet sits to look up at it. Hold it at the floor and it lies down. Let go at its mouth to hand it over, and that rewards the position. Drop it and your pet hunts it down.
- **Play catch**: grab the ball and fling it. Throws follow real physics: gravity, bounces, walls and rolling. A keen dog play-bows while you hold the ball and may catch it mid-air. Cats mostly don't fetch.
- **Pet**: press and hold on your pet. Stroking it feels better than a still hand. Cats have a limit and will tell you when you reach it.
- **Walk**: pick a place, then hold on either side of yourself (or use the arrow keys) to walk. The leash sags and pulls tight. Your pet stops to sniff until you tug, lunges at squirrels and drags you along, and cats often flop down in protest.
- **Walk real routes**: plan a walk on a real map (OpenStreetMap). Search for a place, click out your route, and the app builds the walk from what's really there: park, woods, waterside, beach, streets or shops, with real benches, cafés, fountains, playgrounds and dog parks where they actually are. The walk is as long as the route, your pet checks out the landmarks on the way, and the finds suit the place (seashells only near water). Saved routes work offline afterwards.
- **Your own places**: upload any photo, whether your street, your park or something sillier, and walk your pet there or make it your home backdrop. Nothing is refused: it's your space.
- **Make it yours**: use your own picture as the treat, and change your look by clicking yourself in the scene.
- **Bond hearts**: walks, play, meals, cuddles and training each earn a few hearts a day, up to 10. Hearts raise your bond level (Getting to know you, Warming up, Friends, Good friends, Best friends, Inseparable), and each level unlocks something: harder tricks, gifts, off-leash walks, naps at your feet, a golden tag.
- **Finds and gifts**: on walks your pet sniffs out things to collect (11 kinds, some rare). Once you're friends, it brings you a gift each day.
- **Your pet's voice**: your pet barks or meows out loud. Replace any sound with your own recording or an uploaded clip, like your real pet's bark.
- **Talk to it**: type, or switch on “Talk out loud” where the browser supports speech, and call its name across the room. Try “sit”, “lie down”, “paw”, “spin”, “good girl!”, “no!”, “want a walk?”, “dinner?”

## What makes it feel real

- **Needs on a real clock.** Fullness, energy, fun and affection change while you're away. When you come back, the pet has napped, eaten whatever was in the bowl, and greets you.
- **It decides what to do by itself.** Each pet weighs its needs and personality: napping, wandering, begging at the bowl, asking for attention, the zoomies, grooming, sniffing. It doesn't always do what you ask.
- **It learns from you:**
  - **Tricks** are learned by reward. Give a cue, then reward with a treat, praise or a pat within a few seconds. If you reward it for sitting or lying down on its own, that counts too.
  - **Words** are learned by association. Say “walk” before walks and it starts getting excited when it hears the word. It learns its name the same way.
  - **Routines**: feed it at the same time for a few days and it starts waiting by the bowl around then.
  - **Habits**: what you do most slowly shapes its personality. Lots of fetch makes it more playful, and lots of walks give it more energy.
  - A **journal** records milestones, and a **bond** level grows as you spend time together.
- **Day and night** follow your clock. The window shows the real sky, the lamp comes on in the evening, and pets sleep more at night.

## Running it

**Map walks need the app on its own website.** The claude.ai preview blocks outside sites, so map pictures, place search and map data can't load there. Everything else works in the preview. To host it for free with GitHub Pages: in the repository on GitHub, go to **Settings → Pages**, set **Source** to **Deploy from a branch**, pick **main** and **/ (root)**, and save. A minute later it's at `https://<your-username>.github.io/ai-pet/`.

It's a static site with no build step:

```sh
npm start        # serves on http://localhost:8080
npm test         # runs the behaviour and learning tests (Node 20+)
```

Add `?speed=60` to the URL to run time 60× faster while testing.

The pet is saved in the browser's `localStorage`. Photos and voice clips are kept in IndexedDB. Recording and speech recognition need the page served over HTTPS or from localhost.

Keyboard shortcuts at home: F feeds, T gives a treat, B throws the ball, W starts a walk, C calls your pet. On walks, the arrow keys walk.

## Code layout

| File | What it does |
| --- | --- |
| `src/pet.js` | Pet data: look, traits, needs, bond, saving, catching up after time away |
| `src/learning.js` | Tricks, words, routines, habits, journal milestones |
| `src/bond.js` | Hearts, daily caps, bond levels and unlocks |
| `src/finds.js` | Things to find on walks, and the collection |
| `src/finds-art.js` | Drawings of finds |
| `src/route.js` | Map routes: length, what kind of place each stretch is, landmarks along it (pure, tested offline) |
| `src/route-art.js` | Draws a walk along a real route in 2D |
| `src/map-planner.js` | The map: search, click out a route, fetch OpenStreetMap data, save the walk |
| `vendor/leaflet/` | Leaflet, the map library |
| `src/commands.js` | Turns what you type or say into name, cue, topic and tone |
| `src/world.js` | The pet's behaviour: activities, decision making, reactions to you. No coordinates; it asks the space |
| `src/space-side.js` | The side-on space: positions, movement, ball physics, the leash, hit tests |
| `src/owner-look.js` | Your look options and the default |
| `src/owner-art.js` | Draws you in 2D, with arm and leg IK |
| `src/sound.js` | Synthesised barks and meows, plus custom voice clips |
| `src/media-store.js` | Photos and voice clips in IndexedDB |
| `src/pet-art.js` | Draws the cat or dog from its look and pose |
| `src/renderer.js` | The 2D view: room, park, time of day, particles and speech bubbles |
| `src/scene3d.js` | The 3D view: models, animation choice, hand-made poses, leash, picking with the pointer |
| `vendor/three/` | three.js, kept in the repo so the app needs no build step or CDN |
| `assets/models/` | Free models and animation libraries (see `assets/CREDITS.md`) |
| `src/main.js` | Page wiring: creator, hands-on controls, places, voice, side panel, main loop |

## Roadmap

- **Walk together (opt-in)**: if your routes cross with another walker's, you can see each other on the map. Off by default.
- **Build your space**: arrange and decorate your room and add props to your places, a small, focused take on world-building.
- **Understands speech, for free**: a small open-source model running in the browser (transformers.js) matches what you say to how a pet would react. No server and no API costs.
- **Photo-matched looks**: describe your pet or upload a photo, and Claude sets the coat, markings and build for you.
- **Realistic art style**: swap in paid realistic models (about $20 to $150 per breed) once the 3D version feels right.
- **A cat with more animations**: the free cat only has a walk cycle.
- **Mischief mode**: chewed slippers, shedding and knocked-over cups, if you want them.

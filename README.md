# AI Pet

A virtual cat or dog that behaves like a real one. It gets hungry, tired and bored on a real clock, has its own personality, and learns from how you treat it. No fur on the sofa, no chewed furniture (yet).

## What you can do

Everything happens with your hands in the scene. You appear there as a character you design yourself.

- **Create your pet**: dog or cat, size, ears, coat colour, markings, eyes, collar, name, and four personality traits: energy, playfulness, cuddliness and stubbornness.
- **Create yourself**: hair style and colour, skin tone, top and trousers. You walk over, crouch and reach to do things.
- **Feed**: press the food bag to take a scoop, then hold it over the bowl to pour. You decide how much goes in.
- **Treats and lure training**: take a treat from the jar. Hold it up high and your pet sits to look up at it. Hold it at the floor and it lies down. Let go at its mouth to hand it over, and that rewards the position. Drop it and your pet hunts it down.
- **Play catch**: grab the ball and fling it. Throws follow real physics: gravity, bounces, walls and rolling. A keen dog play-bows while you hold the ball and may catch it mid-air. Cats mostly don't fetch.
- **Pet**: press and hold on your pet. Stroking it feels better than a still hand. Cats have a limit and will tell you when you reach it.
- **Walk**: pick a place, then hold on either side of yourself (or use the arrow keys) to walk. The leash sags and pulls tight. Your pet stops to sniff until you tug, lunges at squirrels and drags you along, and cats often flop down in protest.
- **Your own places**: upload a photo of your street, park or living room. Walk your pet there, or make the photo your home backdrop.
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
| `src/commands.js` | Turns what you type or say into name, cue, topic and tone |
| `src/world.js` | The simulation: activities, decision making, the owner's hands, ball physics, pouring, lure training, leash walks |
| `src/owner.js` | Your character: options and drawing, with arm and leg IK |
| `src/sound.js` | Synthesised barks and meows, plus custom voice clips |
| `src/media-store.js` | Photos and voice clips in IndexedDB |
| `src/pet-art.js` | Draws the cat or dog from its look and pose |
| `src/renderer.js` | Draws the room, park, time of day, particles and speech bubbles |
| `src/main.js` | Page wiring: creator, hands-on controls, places, voice, side panel, main loop |

## Roadmap

- **Pick a place on a map**: search for a park or street and walk there, using map and street imagery.
- **Build your space**: arrange and decorate your room and add props to your places, a small, focused take on world-building.
- **Understands speech (Claude API)**: a small server function sends what you say, plus the pet's state, to Claude. Claude returns how this particular pet would react: tone, intent and which words it would pick up on. The API key stays on the server.
- **Photo-matched looks**: describe your pet or upload a photo, and Claude sets the coat, markings and build for you.
- **Realistic art style**: an alternative renderer using the same behaviour system.
- **Mischief mode**: chewed slippers, shedding and knocked-over cups, if you want them.

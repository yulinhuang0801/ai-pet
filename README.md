# AI Pet

A virtual cat or dog that behaves like a real one. It gets hungry, tired and bored on a real clock, has its own personality, and learns from how you treat it. No fur on the sofa, no chewed furniture (yet).

## What you can do

- **Create your pet**: dog or cat, size, ears, coat colour, markings, eyes, collar, name, and four personality traits: energy, playfulness, cuddliness and stubbornness.
- **Feed** it: food goes in the bowl. A hungry pet comes running; a full one leaves it for later.
- **Give treats**: these are the reward that teaches tricks fastest.
- **Play catch**: tap the floor to throw the ball. Dogs usually bring it back. Cats mostly don't, and sometimes a dog decides the ball is theirs now.
- **Go for walks** in the park. Dogs sniff and chase squirrels. Cats often flop down in protest.
- **Pet it**: press and hold on the pet. Cats have a limit and will tell you when you reach it.
- **Talk to it**: type, or use the mic where the browser supports it. Try its name, “sit”, “lie down”, “paw”, “spin”, “good girl!”, “no!”, “want a walk?”, “dinner?”

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

The pet is saved in the browser's `localStorage`.

## Code layout

| File | What it does |
| --- | --- |
| `src/pet.js` | Pet data: look, traits, needs, bond, saving, catching up after time away |
| `src/learning.js` | Tricks, words, routines, habits, journal milestones |
| `src/commands.js` | Turns what you type or say into name, cue, topic and tone |
| `src/world.js` | The simulation: activities, decision making, reactions to you, ball physics, walks |
| `src/pet-art.js` | Draws the cat or dog from its look and pose |
| `src/renderer.js` | Draws the room, park, time of day, particles and speech bubbles |
| `src/main.js` | Page wiring: creator, controls, side panel, main loop |

## Roadmap

- **Understands speech (Claude API)**: a small server function sends what you say, plus the pet's state, to Claude. Claude returns how this particular pet would react: tone, intent and which words it would pick up on. The API key stays on the server.
- **Generated looks**: describe your pet or upload a photo, and Claude sets the coat, markings and build for you.
- **Realistic art style**: an alternative renderer using the same behaviour system.
- **Mischief mode**: chewed slippers, shedding and knocked-over cups, if you want them.

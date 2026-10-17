# Product framework

How other virtual pets are built, what we take from them, and the order to build in.

## What the well-known pets do

| Pet | What it's built around | What we take from it |
| --- | --- | --- |
| **Tamagotchi** | Needs that run down over real time; neglect has consequences. | Already have this: needs on a real clock. |
| **Nintendogs (DS, 2005)** | Touch to pet and wash. You teach tricks by saying the cue into the microphone. Walks: you **draw a route on a neighbourhood map** through parks, a gym and shops. The dog marks territory, finds presents and meets other dogs. Stamina grows the more you walk. | Map walks with a route you choose, discoveries along the way, stamina that grows. |
| **Nintendogs + Cats (3DS)** | Dropped the map. Places unlock over time (seaside, mountain path, city). A pedometer counts walks while the console is asleep in your pocket. | Real steps can count as walks. Places unlock as you walk more. |
| **Pokémon GO buddy** | Walk 2 km together for a heart. Feeding, petting and photos also earn hearts, with a daily cap. Buddy levels unlock perks, up to Best Buddy. | A bond with named levels and unlocks, and daily caps so a little every day beats one long session. |
| **Neko Atsume** | Put out food and toys, close the app, come back to see who visited. | Give people a reason to check back: something new each visit. |
| **Peridot (Niantic, 2023 to 2026)** | Pets placed into your real surroundings through the phone camera; they react to grass, sand and water. Uses an LLM (Llama 2) to **choose** a reaction from a large animation library, not to make the pet talk. Shut down 31 August 2026. | Use AI to interpret the world and choose a believable reaction. The pet itself never talks. |
| **LLM chat pets** (AI Pet Friends, desktop companions) | The pet chats back in sentences. | Not for us: a real dog doesn't talk, which breaks the realism goal. |
| **Robot pets** (Moflin, Ropet, LOOI) | Physical companions; some recognise faces or use ChatGPT. | Out of scope, but shows the demand for pets that remember you. |

## The framework: five layers

1. **Living pet**: needs, personality, a mind of its own, day and night. *(Built.)*
2. **Hands-on care**: feeding, treats, fetch, petting, done directly in the scene. *(Built, still being polished.)*
3. **Relationship**: bond levels with names and unlocks, learned tricks, words and routines, and a journal. *(Partly built; no unlocks yet.)*
4. **Your world**: where you walk and live together, taken from your real life. *(Weakest part right now; see below.)*
5. **Understanding you**: what you say and do is interpreted the way a real pet would: tone, its name, familiar words. *(Keyword matching only.)*

What we skip: breeding, battling, currencies and shops, and pets that talk.

## “Your world”: why photo backdrops feel wrong, and what to do instead

Pasting any photo behind the pet works for a street shot, but not for a photo of an ID card. Other games avoid this in two ways:

- **Build the scene from what the place is, not from its pixels.** On a real map, a park becomes grass and trees, a street becomes pavement and houses, a beach becomes sand and water. A route through your neighbourhood then becomes a walk that passes the real places in order. This also gives discoveries and other dogs somewhere to appear, as in Nintendogs.
- **Check uploaded photos.** A vision model can say “this is a park at dusk with a pond” (and the scene is styled to match) or “this isn't a place” (and the upload is refused).

## Technology choices

### Maps
- **OpenStreetMap with Leaflet or MapLibre**: free with no API key, and it has the place data we need (parks, paths, water, buildings). Its public tile servers have a fair-use policy, so a real launch would need a tile provider.
- **Google Maps Platform**: needs an API key and a billing account. Since March 2025 each API gets its own free monthly allowance, for example 10,000 dynamic map loads, 10,000 Static Street View images and 10,000 Place Details. That's plenty for a prototype. Use it if we want Google's search box or Street View imagery.
- Recommendation: start with OpenStreetMap because it needs no key or bill, and keep Google as an option for search and Street View later.

### Understanding speech (LLM)
- Any of Claude, Gemini or DeepSeek can do this. The model's job is small: take what you said and the pet's state, and return one reaction from a fixed list (the Peridot pattern). That's a few hundred tokens per sentence, so the cost is tiny with any of them.
- The API key must stay on a small server, never in the web page. Easy options: a Cloudflare Worker or a Vercel function.
- Speech to text: the browser's built-in speech recognition (Chrome, Edge, Safari) is free. A transcription API would cover other browsers.
- Check each provider's data-handling terms, since this sends what people say to their pet.

### Platform
- **Web app (current)**: fastest to iterate, and works on phones.
- Real-step walks (pedometer or GPS) and camera AR work far better in a mobile app. Revisit once the core feels right.

## Build order

1. **Polish the core**: fix bugs; add bond levels with unlocks; give each day something to come back for, like a gift found on a walk or a visitor.
2. **Map walks**: pick a place on a real map, draw a route, and walk a scene generated from what is actually there, with discoveries along the way.
3. **Understanding you**: a small server that uses an LLM to choose the pet's reaction.
4. **Smart photo places**: a vision model checks each uploaded photo and styles the scene from it.
5. **Going mobile**: real steps count as walks, maybe a camera view.

## Sources

- Nintendogs walk map and destinations: [Nintendo World Report review](https://nintendoworldreport.com/review/4394/nintendogs-nintendo-ds), [Supercheats Q&A](https://www.supercheats.com/nintendods/questions/nintendogsdalmatianandfriends/79727/how-do-i-get-to-the-park.htm)
- Nintendogs + Cats walks and pedometer: [Giant Bomb](https://www.Giantbomb.com/nintendogs-cats/3030-31736/)
- Pokémon GO Buddy Adventure: [Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Buddy_Adventure), [Dexerto guide](https://www.dexerto.com/pokemon/pokemon-go-buddy-adventure-guide-1303955)
- Peridot and its use of Llama 2: [Meta case study](https://ai.meta.com/blog/niantic-peridot-llama/), [Niantic](https://nianticlabs.com/news/peridot-generative-ai), [Wikipedia](https://en.wikipedia.org/wiki/Peridot_(franchise))
- Neko Atsume loop: [student review](https://blogs.lwhs.org/hyphen/2016/03/16/neko-atsume)
- Google Maps Platform pricing: [Google's pricing page](https://developers.google.com/maps/billing-and-pricing/pricing), [Woosmap breakdown](https://www.woosmap.com/blog/google-maps-api-pricing-breakdown)
- LLM and AI pet landscape: [Smart Snout 2026 guide](https://thesmartsnout.com/2026/02/21/virtual-pet-apps-guide-2026-ai-coparenting/), [Cybernews robot pets](https://cybernews.com/ai-tools/best-ai-robot-pets/)

// Turns what the owner types or says into what a pet could pick up on:
// its name, a cue word, a topic it might know, and the tone of voice.

const TRICK_CUES = [
  ['down', /\b(lie down|lay down)\b/],
  ['sit', /\bsit\b/], // "sit down" means sit
  ['down', /\bdown\b/],
  ['paw', /\b(paw|shake|high five)\b/],
  ['spin', /\b(spin|twirl|turn around)\b/],
];

const TOPICS = [
  ['walk', /\b(walk|walkies|outside|go out)\b/],
  ['dinner', /\b(dinner|breakfast|food|eat|hungry)\b/],
  ['ball', /\b(ball|fetch|catch)\b/],
  ['treat', /\b(treats?|snack|cookie)\b/],
];

const PRAISE = /\b(good|clever|smart|well done|yes|nice|love you|cutie|sweet|best)\b/;
const SCOLD = /\b(no|bad|stop|naughty|off|drop it|leave it)\b/;
const COME = /\b(come|here|c'mon|come on)\b/;

export function parseUtterance(text, petName = '') {
  const s = ` ${text.toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ')} `;
  const name = petName ? new RegExp(`\\b${petName.toLowerCase().replace(/[^a-z' ]/g, '')}\\b`).test(s) : false;
  const trick = TRICK_CUES.find(([, re]) => re.test(s))?.[0] ?? null;
  const topic = TOPICS.find(([, re]) => re.test(s))?.[0] ?? null;
  const scold = SCOLD.test(s) && !/\bno problem\b/.test(s);
  const praise = !scold && PRAISE.test(s);
  const come = COME.test(s);
  const excited = /!/.test(text) || /\b(who's a|wanna|want to|ready)\b/.test(s);
  return { name, trick, topic, praise, scold, come, excited };
}

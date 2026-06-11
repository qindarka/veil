/**
 * shared/storyData.ts
 * THE campaign content for "Echoes of the Veil" — every NPC, item, story
 * beat, group choice, random event, ending and loading-screen whisper, as
 * pure data conforming to the schema in shared/story.ts.
 *
 * This module is imported by BOTH the browser client and the Cloudflare
 * Worker: no side effects, no DOM, no three.js — data only.
 *
 * Authoring rules observed here:
 *  - Every objectId referenced below comes from the canonical interactable
 *    table in docs/ARCHITECTURE.md. Do not invent ids.
 *  - Canonical flags: `awakened`, `echo-caelis`, `echo-archive`, `echo-wood`,
 *    `act3-open`. Choice flags are automatic (`choice:<id>:<option>`).
 *    Endings: `ending-wake`, `ending-mend`, `ending-become`.
 *  - Dialogue-chain beats guard themselves with both `none:` (not yet fired)
 *    and `all:` (previous link fired) flags so chain order never depends on
 *    the director's beat-matching order.
 *  - The "any 2 of 3 echoes" act-3 gate cannot be expressed in one FlagExpr,
 *    so it is implemented as three beats (one per echo pair) sharing the same
 *    prose, each guarded by `none: ['act3-open']` so exactly one ever fires.
 */

import type { StoryData } from './story';

// ── Shared prose for the three act-3 gate beats (one semantic beat) ─────────
const GATE_TITLE = 'The Veil Holds Its Breath';
const GATE_TEXT =
  '( two songs returned. the quiet notices. ) Across every sky at once, the ' +
  'aurora stops mid-ripple. Far past the cloud-sea, a road none of you opened ' +
  'opens itself: a pale stair, winding down toward a heart-light that beats ' +
  'too slowly. The Hush is gathering there — not to fight you. To finish ' +
  'something. ( come down, the quiet does not say. it has stopped saying ' +
  'anything at all. that is the danger. )';
const GATE_FOCUS =
  'Anchored, you hear what lives underneath the quiet: not silence — a held ' +
  'breath. The Hush is the Dreamer’s grief curled so tight it stopped making ' +
  'sound. It is not winning. It is finishing — the way a person finishes ' +
  'crying when they are certain no one is coming. There is still time to come.';

export const STORY: StoryData = {
  // ═══════════════════════════════════════════════════════════════════════
  // NPCs — the six Echoes and the Hush
  // ═══════════════════════════════════════════════════════════════════════
  npcs: {
    serai: {
      id: 'serai',
      name: 'Serai',
      title: 'the Lantern-Bearer',
      color: '#ffd27a',
      description:
        'The first Echo the Dreamer ever made: a keeper of lights braided out of warm gold. She has tended the Skyharbor’s lanterns alone for longer than she will say, so that whoever finally came would not arrive in the dark.',
    },
    aurel: {
      id: 'aurel',
      name: 'Aurel',
      title: 'the Crystalwright',
      color: '#8d7bff',
      description:
        'The Echo who sang Caelis out of raw light and taught the city its chord. When the Hush drank the city’s sound mid-song, Aurel kept building — faster and faster — so he would never have to stand still inside the silence.',
    },
    thessaly: {
      id: 'thessaly',
      name: 'Thessaly',
      title: 'the Archivist',
      color: '#4be3c3',
      description:
        'Keeper of the Sunken Archive, where every memory the waking world loses washes down to be shelved. Dry as old paper on the surface, fathoms-deep underneath. She has read everything in her library except the one thing that matters.',
    },
    rowan: {
      id: 'rowan',
      name: 'Rowan',
      title: 'Warden of the Wood',
      color: '#9fe060',
      description:
        'Bark-skinned and plainspoken, Rowan walks with the Wandering Wood wherever it wanders. They planted the Heartwood long ago with someone who has since woken up and never come back; the tree is the promise neither of them said aloud.',
    },
    reflection: {
      id: 'reflection',
      name: 'The Reflection',
      title: 'the Dreamer’s Reflection',
      color: '#a9c8ff',
      description:
        'What the Dreamer sees when the water is kind. It rises from the Mirrormere wearing your faces in turn, speaks mostly in questions, and remembers every answer anyone has ever given it.',
    },
    dreamer: {
      id: 'dreamer',
      name: 'The First Dreamer',
      title: 'Heart of the Veil',
      color: '#ffe9b3',
      description:
        'The sleeper whose long dream is the Veil entire. Vast, gentle, and very tired. They dreamed a world so the dark would have someone in it — and have grieved, quietly, for every dreamer the morning took back.',
    },
    hush: {
      id: 'hush',
      name: 'The Hush',
      title: 'Grief Made Quiet',
      color: '#7d739c',
      description:
        'Not a villain. Not even a thing, quite: the Dreamer’s unwept grief, calcified into a stillness that drinks song and color. It speaks — when it speaks at all — in the spaces between sounds.',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Items — mementos granted along the way (emoji icons are swap-friendly)
  // ═══════════════════════════════════════════════════════════════════════
  items: {
    'first-light': {
      id: 'first-light',
      name: 'A Drop of First Light',
      description:
        'A knot of warmth saved coal by coal by a hundred dreams of lighthouse keepers. The dark thins, slightly, everywhere you will ever stand.',
      icon: '🏮',
    },
    'silent-chord': {
      id: 'silent-chord',
      name: 'The Silent Chord',
      description:
        'The last three notes of an unfinished song, folded into glass. They are not lost. They are waiting for the rest of the music to come home.',
      icon: '🎼',
    },
    'ember-key': {
      id: 'ember-key',
      name: 'The Ember Key',
      description:
        'An unfinished key from a cold forge, completed at last by a maker’s hand. It does not open doors. It opens mornings.',
      icon: '🗝️',
    },
    'unwritten-page': {
      id: 'unwritten-page',
      name: 'The Unwritten Page',
      description:
        'A page from a blank book that writes back. Whatever you need to remember most will be on it, the next time you look.',
      icon: '📖',
    },
    'tide-pearl': {
      id: 'tide-pearl',
      name: 'The Tide-Pearl',
      description:
        'A pearl the deep kept safe, with a drowned lullaby still circling inside it. Hold it to your ear on bad nights.',
      icon: '🦪',
    },
    'thorn-charm': {
      id: 'thorn-charm',
      name: 'The Thorn-Charm',
      description:
        'A green knot of living briar, given freely by a forest paying down a very old debt. Paths will always, eventually, part for you.',
      icon: '🌿',
    },
    'ward-knot': {
      id: 'ward-knot',
      name: 'The Ward-Knot',
      description:
        'A guardian-stone’s heart, rewoven by a warden’s vigil. Whatever circles the people you love will have to circle wider now.',
      icon: '🪢',
    },
    'hush-glass': {
      id: 'hush-glass',
      name: 'The Hush-Glass',
      description:
        'A lens of cooled silence, taken from inside the Hush itself. Through it, every frightening stillness shows the small true thing it is protecting.',
      icon: '🔮',
    },
    'shard-tear': {
      id: 'shard-tear',
      name: 'The Shard-Tear',
      description:
        'A splinter of the Hush from Caelis, gone quiet at last. Warm to the touch, like a cheek after crying.',
      icon: '💠',
    },
    'memory-drop': {
      id: 'memory-drop',
      name: 'A Drop of the Pool',
      description:
        'One bead of water from the Memory Pool. It weighs exactly as much as the moment you most want to keep.',
      icon: '💧',
    },
    'heartwood-seed': {
      id: 'heartwood-seed',
      name: 'The Heartwood Seed',
      description:
        'A seed from the great tree, given the day the party chose for it. Plant it anywhere — in soil, in a story, in someone.',
      icon: '🌱',
    },
    'still-water': {
      id: 'still-water',
      name: 'A Phial of Still Water',
      description:
        'Water from the Still Pool, which forgets to reflect and shows instead. The Veil holds you a little more surely while you carry it.',
      icon: '🌙',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Beats
  // ═══════════════════════════════════════════════════════════════════════
  beats: [
    // ───────────────────────────────────────────────────────────────────
    // ACT 1 — The Skyharbor
    // ───────────────────────────────────────────────────────────────────
    {
      id: 'a1-arrival',
      act: 1,
      title: 'Falling Upward',
      location: 'skyharbor',
      trigger: { type: 'enterLocation', location: 'skyharbor' },
      text:
        'You do not remember falling asleep. You remember falling upward — through your own ceiling, through cloud, through a skin of light — and landing here: a harbor moored to nothing, lanterns burning gold against a sea of sky. Somewhere below, your body is sleeping. Somewhere close, something enormous is dreaming you a place to stand. The boards are warm underfoot. The wind smells of rain that has not been invented yet.',
      focusText:
        'Anchored and still, you notice what the wind was hiding: the harbor is breathing. Once a minute, slow as sleep, the whole island rises and settles like a chest. And far out in the cloud-sea, small lights answer the lanterns — blink for blink. Not reflections. Replies.',
      effects: [
        {
          type: 'journal',
          category: 'story',
          title: 'The Skyharbor',
          text: 'We arrived in the Veil at a harbor moored to the sky. Someone keeps the lanterns lit here. Someone was expecting us.',
        },
      ],
    },
    {
      id: 'a1-serai',
      act: 1,
      title: 'The Lantern-Bearer',
      location: 'skyharbor',
      speaker: 'serai',
      trigger: { type: 'interact', objectId: 'sky_echo_serai' },
      text:
        'The figure waiting at the quay’s edge is warm light loosely braided into a woman — she has clearly been standing here a while, watching the road you arrived by. “Veilwalkers. Good. The Veil called louder than I dared hope.” She lifts her lantern to your faces one by one, as if memorizing them. “I am Serai. I keep the lights; the lights keep the harbor; the harbor keeps the dream from coming apart entirely. We are losing it, friends — the Hush drinks the Veil one song at a time. Wake the three sky-glyphs by the quay, together, while the light is willing. Light remembers light. Then I will open the old roads.”',
      focusText:
        'Held in your stillness, her braided light loosens at the edges. “I was the first the Dreamer made,” she says, quieter. “I have watched the Hush take the others’ places one by one and could only keep lamps against it. I lit every lantern on this harbor so that whoever finally came would not arrive in the dark. You came. That is already more than I had yesterday.”',
      effects: [
        { type: 'setFlag', flag: 'serai-met' },
        { type: 'relationship', npcId: 'serai', delta: 1 },
        {
          type: 'journal',
          category: 'clue',
          title: 'Wake the three glyphs',
          text: 'Serai asks us to wake the three sky-glyphs by the quay — together, within a breath of one another. Light remembers light.',
        },
      ],
    },
    {
      // Serai's second line — fires on any return visit (every other Echo NPC
      // has a dialogue chain; this one reads the serai-met flag).
      id: 'a1-serai-2',
      act: 1,
      title: 'Keeper of the Lights',
      location: 'skyharbor',
      speaker: 'serai',
      trigger: { type: 'interact', objectId: 'sky_echo_serai' },
      when: { all: ['serai-met'] },
      text:
        '“Still here. Still lit.” Back at her post by the great lamp, Serai trims a lantern that does not need trimming — keepers keep; it is what the word is for. “Whatever you find out on the roads, bring it back and tell me. Even the heavy parts. Especially the heavy parts. A harbor is just a place where stories agree to land.” She glances out at the cloud-sea, then back, and the light of her braids steadies. “And if the Hush gets loud out there, remember — it cannot take what you give to each other. Speak. Sing badly. Hold the line.”',
      focusText:
        'In the anchored hush she adds, almost too soft to keep: “I knew the seventh keeper — the one scraped from the mural. The Dreamer did not remove them in anger. They removed themselves, to carry the grief out of the picture. If you meet something out there that sounds like silence apologizing… be kind to it. It used to sing the rest of us awake.”',
      effects: [{ type: 'relationship', npcId: 'serai', delta: 1 }],
    },
    {
      id: 'a1-mural',
      act: 1,
      title: 'The Mural of the First Morning',
      location: 'skyharbor',
      trigger: { type: 'interact', objectId: 'sky_lore_mural' },
      text:
        'Paint that is not paint: the mural moves the way memory does when you look straight at it. A sleeping figure, curled. Rising from their chest like smoke — the whole world: harbor, city, library, forest, lake, all of it one exhaled breath. Six small bright figures stand in the breath, holding it open. In the lowest corner a seventh shape was painted dark, then scraped carefully away. Not torn. Not defaced. Removed gently, the way you take down a photograph that hurts.',
      effects: [
        {
          type: 'journal',
          category: 'lore',
          title: 'The First Morning',
          text: 'A mural shows the Veil rising from a sleeping figure’s chest, held open by six bright Echoes. A seventh, dark figure was scraped away — gently.',
        },
      ],
    },
    {
      id: 'a1-bell',
      act: 1,
      title: 'The Harbor Bell',
      location: 'skyharbor',
      trigger: { type: 'interact', objectId: 'sky_lore_bell' },
      text:
        'An old bronze bell hangs over the quay, green with sky-salt. It has no clapper — never had one; the mounting was cast solid. The harbor folk of some forgotten dream rigged no rope, left no mallet. Etched around the rim, in letters worn soft: IT RINGS ON TRUE THINGS. Beneath that, smaller, in a different and shakier hand: and lately it has been so quiet.',
      effects: [
        {
          type: 'journal',
          category: 'lore',
          title: 'The clapperless bell',
          text: 'The harbor bell has no clapper and rings anyway — on true things, says the rim. Lately it has been quiet.',
        },
      ],
    },
    {
      id: 'a1-loom',
      act: 1,
      title: 'The Loom of Echoes',
      location: 'skyharbor',
      trigger: { type: 'interact', objectId: 'sky_loom' },
      when: { none: ['awakened'] },
      text:
        'Strung between two mooring posts: a loom of light, weaving slowly with no weaver. The cloth on its frame is the campaign of the world — you can see the harbor in it, and your own arrival, a fresh bright row still warm from the shuttle. But whole regions of the weave hang slack. Three threads are severed outright, their colors pooled and waiting. The loom works on regardless, patient as tide, leaving room in the pattern for everything it still hopes will return.',
      effects: [
        {
          type: 'journal',
          category: 'lore',
          title: 'The Loom of Echoes',
          text: 'A weaverless loom on the quay weaves the story of the Veil as it happens. Three threads hang severed. The pattern leaves room for their return.',
        },
      ],
    },
    {
      // Post-awakening Loom reading — without this, a party that woke the
      // glyphs before touching the Loom would find the shrine inert for the
      // whole campaign (the beat above is gated none:[awakened]).
      id: 'a1-loom-after',
      act: 1,
      title: 'The Loom, Weaving',
      location: 'skyharbor',
      trigger: { type: 'interact', objectId: 'sky_loom' },
      when: { all: ['awakened'] },
      text:
        'The loom works faster now that the roads are open — the shuttle of light fairly leaps, taking up your journey row by row. Look closely and the weave tells you exactly where you stand: every road you have walked shines; every choice you have made sits knotted and permanent in the cloth; and the severed threads of the missing Echoes wait in their pooled colors at the margin, each one braided back in while you watch the moment you bring it home. The pattern is not finished. It is — the loom seems certain — finishable.',
      effects: [
        {
          type: 'journal',
          category: 'clue',
          title: 'Read the Loom',
          text: 'The Loom weaves our campaign as we live it. Severed threads at the margin mark the Echoes still missing; recoveries are braided back in.',
        },
      ],
    },
    {
      id: 'a1-awakening',
      act: 1,
      title: 'The Awakening',
      location: 'skyharbor',
      trigger: {
        type: 'allInteract',
        objectIds: ['sky_glyph_1', 'sky_glyph_2', 'sky_glyph_3'],
        windowMs: 60000,
      },
      text:
        'The third glyph catches the song of the first two and the quay ignites — lines of gold racing under the boards, up the mooring chains, out along roads of light you could not see until they remembered themselves. The harbor was a crossroads once. It is again. Out in the cloud-sea four ways kindle awake: a city of violet crystal, a drowned glow far below, a forest already walking to meet you, and a lake lying perfectly, impossibly still. Serai laughs like a struck bell. “The roads are open. Oh, the roads are open.”',
      focusText:
        'In the held moment you see down through the boards — down the roads of light, down miles of dream — to where every thread of the loom converges: a sleeping figure, curled around a small dark star, holding it the way you hold a thing you cannot bear to look at and cannot bear to put down.',
      effects: [
        { type: 'setFlag', flag: 'awakened' },
        { type: 'unlockLocation', location: 'caelis' },
        { type: 'unlockLocation', location: 'sunken-archive' },
        { type: 'unlockLocation', location: 'wandering-wood' },
        { type: 'unlockLocation', location: 'mirrormere' },
        { type: 'setAct', act: 2 },
        { type: 'mood', mood: 'hopeful' },
        {
          type: 'journal',
          category: 'story',
          title: 'The roads are open',
          text: 'We woke the sky-glyphs together. Four old roads kindled: Caelis, the Sunken Archive, the Wandering Wood, and the Mirrormere. Three Echoes are waiting to be found.',
        },
        { type: 'triggerBeat', beatId: 'a1-oath', delayMs: 6000 },
      ],
    },
    {
      id: 'a1-oath',
      act: 1,
      title: 'The Oath at the Loom',
      location: 'skyharbor',
      speaker: 'serai',
      trigger: { type: 'manual' },
      text:
        'Serai gathers you at the Loom of Echoes, where new-woken threads of gold hang waiting to be tied in. “A dream holds its shape around a promise,” she says. “The roads will test you, and the Hush will offer you its terrible quiet, and on that day what you swore will matter more than what you carry. So — before you go. Give the Loom one promise. It will hold you to it. And it will hold because of it.”',
      choice: {
        id: 'oath',
        prompt: 'What does the party swear to the Loom?',
        durationMs: 60000,
        options: [
          {
            id: 'remember',
            label: 'We will remember',
            description:
              'Carry every forgotten name and unfinished song back into the light. Nothing loved is lost while we walk.',
          },
          {
            id: 'shelter',
            label: 'We will shelter',
            description:
              'Stand between the small sleeping things and whatever circles them. No one is left alone in the dark.',
          },
          {
            id: 'mend',
            label: 'We will mend',
            description:
              'Leave every broken thing better than we found it. Even the grief. Especially the grief.',
          },
        ],
      },
      effects: [
        {
          type: 'journal',
          category: 'story',
          title: 'The Oath',
          text: 'At Serai’s asking, we swore an oath to the Loom of Echoes. The dream will hold its shape around it.',
        },
      ],
    },
    {
      id: 'gift-lumen',
      act: 1,
      title: 'A Cache of First Light',
      location: 'skyharbor',
      trigger: { type: 'interact', objectId: 'sky_hidden_lumen' },
      text:
        'Only you feel it: warmth pooled behind the harbor’s oldest lamp, banked like a coal against a long night. Inside the hollow lies a knot of First Light — saved, you understand all at once, by the lighthouse keepers of a hundred dreams before yours, each one adding a little on their way through. You add a little. You take a little. That is how it works. That is how it has always worked. The dark thins, just slightly, everywhere you will ever stand.',
      effects: [
        { type: 'setFlag', flag: 'gift-lumen' },
        { type: 'giveItem', itemId: 'first-light', to: 'interactor' },
        { type: 'relationship', npcId: 'serai', delta: 1 },
        {
          type: 'journal',
          category: 'lore',
          title: 'The keepers’ cache',
          text: 'Behind the oldest lamp: First Light, saved coal by coal by every lightkeeper who ever dreamed through here. Our Lumenkeeper added to it, and took a share.',
        },
      ],
    },
    // ───────────────────────────────────────────────────────────────────
    // ACT 2 — Caelis, the Crystal City
    // ───────────────────────────────────────────────────────────────────
    {
      id: 'cae-arrival',
      act: 2,
      title: 'The City That Was Sung',
      location: 'caelis',
      trigger: { type: 'enterLocation', location: 'caelis' },
      when: { all: ['awakened'] },
      text:
        'Caelis rises around you in spires of violet crystal, and the first thing you notice is that you can hear the architecture: every street hums a low chord, every archway a different interval, the whole city one patient piece of music. The second thing you notice is the gaps. Whole districts stand gray and glassy and utterly soundless, like rests held too long. The music keeps playing around them. It has learned to. You can hear how much that cost.',
      focusText:
        'Anchored, you make out the shape of the missing music. The gray districts are not silent at random — together they spell an absence with edges, like a figure cut out of a photograph. Somewhere in this city, all that swallowed sound is being kept. Compressed. Carried by something that thinks carrying it alone is a kindness.',
      effects: [
        {
          type: 'journal',
          category: 'story',
          title: 'Caelis',
          text: 'The crystal city is one patient piece of music — with districts gone gray and soundless where the Hush has drunk it. The lost sound is being kept somewhere.',
        },
      ],
    },
    {
      id: 'cae-aurel-1',
      act: 2,
      title: 'The Crystalwright',
      location: 'caelis',
      speaker: 'aurel',
      trigger: { type: 'interact', objectId: 'cae_echo_aurel' },
      when: { none: ['aurel-1'] },
      text:
        '“Mind the lintel, it’s new.” The Echo in the half-built doorway is violet light worked like glass, sleeves pushed up, dust of crystal on his hands. “Aurel. Crystalwright. I sang this city up from raw light, once — taught every street its chord.” He sets another shining course, not looking at you. “Then the Hush came through mid-song and drank the sound right out of the stone. So now I build. A window a day. A stair. If you stop to listen to the quiet, walkers, it gets into you. Better to keep the hands moving.”',
      effects: [
        { type: 'setFlag', flag: 'aurel-1' },
        { type: 'relationship', npcId: 'aurel', delta: 1 },
      ],
    },
    {
      id: 'cae-aurel-2',
      act: 2,
      title: 'What the City Needs',
      location: 'caelis',
      speaker: 'aurel',
      trigger: { type: 'interact', objectId: 'cae_echo_aurel' },
      when: { all: ['aurel-1'], none: ['aurel-2'] },
      text:
        'Aurel finally sets down his tools. “You want to help. Fine. Hear me, then: a city sung up can be sung back. Three resonance crystals survive from the founding — I hid them where the Hush forgot to look. Ring them together, all three within a breath, and Caelis will remember its chord whether the quiet likes it or not.” He flexes crystal-dusted fingers. “Fair warning. When the music comes back, everything the Hush has been holding will have nowhere left to hide. Including the part of it that is mine.”',
      focusText:
        'In the anchored hush he says the rest, very evenly, like a man reading an inventory: “I was conducting when it happened. The whole city, one song, my hands in the air. I have not let myself hear the silence since. I built faster so I would not have to grieve it. You will find my grief in the plaza, walkers, wearing the Hush like a coat. Be kinder to it than I was.”',
      effects: [
        { type: 'setFlag', flag: 'aurel-2' },
        {
          type: 'journal',
          category: 'clue',
          title: 'Ring the three crystals',
          text: 'Aurel: ring the three hidden resonance crystals within a breath of one another, and Caelis will remember its chord. Whatever the Hush is holding will surface.',
        },
      ],
    },
    {
      id: 'cae-throne',
      act: 2,
      title: 'The Listening Throne',
      location: 'caelis',
      trigger: { type: 'interact', objectId: 'cae_lore_throne' },
      text:
        'A throne of grown amethyst stands in an empty court — and the plaque kneels you down to read it: CAELIS HAS NO RULER. THIS SEAT BELONGS TO WHOEVER MOST NEEDS TO BE HEARD TODAY. The stone is worn smooth by generations of ordinary sitters: the wronged, the frightened, the simply lonely, each given a city’s full attention for an afternoon. A skin of gray hush-frost is creeping up one armrest now. Apparently even an empty chair that listens is something grief cannot leave alone.',
      effects: [
        {
          type: 'journal',
          category: 'lore',
          title: 'The Listening Throne',
          text: 'Caelis has no ruler. Its throne belongs to whoever most needs to be heard that day. Hush-frost is creeping up the armrest.',
        },
      ],
    },
    {
      id: 'cae-fountain',
      act: 2,
      title: 'The Fountain of Light',
      location: 'caelis',
      trigger: { type: 'interact', objectId: 'cae_lore_fountain' },
      text:
        'The fountain runs with light instead of water — gold pouring up, violet spilling down, the basin brimming with slow liquid glow. Citizens once drank from it, the inscriptions say: a swallow of light to carry you through a heavy day. Watch long enough and you notice the flow stutter — a skipped pulse, every so often, regular as a heartbeat under strain. The fountain draws from the Heart of the Veil. Whatever is happening down there, this is its pulse, and it is tiring.',
      effects: [
        {
          type: 'journal',
          category: 'lore',
          title: 'A tiring pulse',
          text: 'The fountain of Caelis pours light drawn from the Heart of the Veil — and its flow stutters like a heartbeat under strain.',
        },
      ],
    },
    {
      id: 'cae-resonance',
      act: 2,
      title: 'The Chord Remembered',
      location: 'caelis',
      trigger: {
        type: 'allInteract',
        objectIds: ['cae_resonance_1', 'cae_resonance_2', 'cae_resonance_3'],
        windowMs: 30000,
      },
      text:
        'Three crystals ring as one — and the city answers. The chord goes through Caelis like dawn through a window: street by street the gray districts flush violet, archways remember their intervals, a thousand crystal panes shiver back into tune. And in the great plaza, all the swallowed sound has nowhere left to hide. It contracts, fleeing the music, condensing out of the air — until a single dark shard hangs above the shrine stone, humming with everything it drank. The city falls quiet around it. Voluntarily, this time. Out of respect.',
      focusText:
        'Anchored inside the returning chord, you can pick out single threads of it: a baker singing off-key three centuries ago; rain on ten thousand skylights; a child practicing scales, stubbornly, wrong note and all. The city was never performing. It was keeping everyone. That is what the Hush could not bear to hear, and could not bear to lose.',
      effects: [
        { type: 'setFlag', flag: 'caelis-attuned' },
        {
          type: 'journal',
          category: 'clue',
          title: 'The shard surfaces',
          text: 'The chord drove the swallowed sound into one dark shard above the plaza shrine. Aurel’s grief is inside it. It must be faced.',
        },
      ],
    },
    {
      id: 'cae-shard',
      act: 2,
      title: 'The Hush-Shard',
      location: 'caelis',
      speaker: 'hush',
      trigger: { type: 'interact', objectId: 'cae_hush_shard' },
      when: { all: ['caelis-attuned'] },
      text:
        '( the shard hangs where the chord cornered it. inside: every sound the city lost, packed tight as a held breath. and underneath, very small, someone building and crying at once. ) Aurel arrives at a run and stops dead. “That’s mine,” he says quietly. “That’s the part I wouldn’t carry.” The shard turns slowly, drinking the lamplight. It is heavier than the city. It is the size of a held note. ( it will not fight you. it is waiting, the way grief waits, to find out what you are going to do with it. )',
      choice: {
        id: 'hush-shard',
        prompt: 'The Hush-shard — grief made solid. What does the party do with it?',
        durationMs: 60000,
        options: [
          {
            id: 'cleanse',
            label: 'Cleanse it',
            description:
              'Sing the grief through, note by note. Slow, and it will hurt, and Aurel must stand and listen to all of it.',
          },
          {
            id: 'shatter',
            label: 'Shatter it',
            description:
              'Break it now, before it drinks another street. Quick, and final — and some of what it swallowed stays lost.',
          },
        ],
      },
      effects: [{ type: 'mood', mood: 'tension' }],
    },
    {
      id: 'cae-echo-cleanse',
      act: 2,
      title: 'The Long Song',
      location: 'caelis',
      speaker: 'aurel',
      trigger: { type: 'choiceResolved', choiceId: 'hush-shard', optionId: 'cleanse' },
      text:
        'You sing the grief through. It takes everything the party has — note after note drawn out of the shard like splinters, each one a sound the city lost, each one passing through Aurel on its way home. He stands and takes all of it. The last note is his own voice, mid-song, three hundred years ago. When it finally fades the shard is gone and the plaza is full of ordinary evening noise, and Aurel is on his knees, laughing, wet-faced, conducting nothing. “There it is,” he keeps saying. “There it all is.” The Echo of Caelis is whole.',
      effects: [
        { type: 'setFlag', flag: 'echo-caelis' },
        { type: 'relationship', npcId: 'aurel', delta: 2 },
        { type: 'giveItem', itemId: 'shard-tear', to: 'all' },
        { type: 'mood', mood: 'hopeful' },
        {
          type: 'journal',
          category: 'story',
          title: 'The Echo of Caelis',
          text: 'We sang the Hush-shard through, note by note, and Aurel stood in the current of it. The city has its whole song back — and its Crystalwright. One Echo restored.',
        },
      ],
    },
    {
      id: 'cae-echo-shatter',
      act: 2,
      title: 'The Breaking',
      location: 'caelis',
      speaker: 'aurel',
      trigger: { type: 'choiceResolved', choiceId: 'hush-shard', optionId: 'shatter' },
      text:
        'The shard breaks like a winter lake. Everything it drank comes back at once — bells, voices, rain, three centuries of evenings detonating across the plaza in one magnificent unbearable chord — and then it is over, and the city is loud and alive and missing things. Small sounds. A particular laugh. The end of one song. Gone where broken things go. Aurel stands very still in the ringing air. “Quick is also a mercy,” he says at last, to no one, evening his breath. “I will tell myself that.” The Echo of Caelis is whole. Most of him.',
      effects: [
        { type: 'setFlag', flag: 'echo-caelis' },
        { type: 'relationship', npcId: 'aurel', delta: -1 },
        { type: 'giveItem', itemId: 'shard-tear', to: 'all' },
        { type: 'mood', mood: 'hopeful' },
        {
          type: 'journal',
          category: 'story',
          title: 'The Echo of Caelis',
          text: 'We shattered the Hush-shard. The city’s sound came back in one blow — most of it. Aurel is restored, and quieter than the story says he used to be. One Echo recovered.',
        },
      ],
    },
    {
      id: 'gift-songweaver',
      act: 2,
      title: 'The Unfinished Chord',
      location: 'caelis',
      trigger: { type: 'interact', objectId: 'cae_hidden_songweaver' },
      text:
        'Everyone else walks past the wall. You stop, because the wall is humming — a crystal lute fused into the masonry mid-song, three notes short of resolving, holding its unfinished chord the way a dreamer holds a breath. It has waited centuries for someone who could hear it. You rest your fingers on the strings and give it the three notes it was owed. The resolution rings down the whole street, and somewhere far off, the city’s great chord adjusts itself — making room, after all this time, for one more voice.',
      effects: [
        { type: 'setFlag', flag: 'gift-songweaver' },
        { type: 'giveItem', itemId: 'silent-chord', to: 'interactor' },
        { type: 'relationship', npcId: 'aurel', delta: 1 },
        {
          type: 'journal',
          category: 'lore',
          title: 'One more voice',
          text: 'Our Songweaver found a crystal lute fused into a wall, three notes from resolving — and finished it. The city’s chord made room for it.',
        },
      ],
    },
    {
      id: 'gift-embersmith',
      act: 2,
      title: 'The Cold Forge',
      location: 'caelis',
      trigger: { type: 'interact', objectId: 'cae_hidden_embersmith' },
      text:
        'Down a side-street the others’ eyes slide past: a forge, cold so long the anvil has forgotten its ring. You know this kind of workshop — your family kept one. Tools for dreamers: keys, lanterns, compasses that point at longing. On the anvil lies an unfinished key, abandoned mid-make the day the silence came. Your hands know what to do before you do. One true strike. The forge-light blooms ember-orange off the crystal walls, and the key grows warm in your palm, finished, and the street remembers what mornings sounded like.',
      effects: [
        { type: 'setFlag', flag: 'gift-embersmith' },
        { type: 'giveItem', itemId: 'ember-key', to: 'interactor' },
        { type: 'relationship', npcId: 'aurel', delta: 1 },
        {
          type: 'journal',
          category: 'lore',
          title: 'The forge relit',
          text: 'Our Embersmith found the cold dream-forge of Caelis and finished the key left on its anvil. The forge-light is back.',
        },
      ],
    },
    // ───────────────────────────────────────────────────────────────────
    // ACT 2 — The Sunken Archive
    // ───────────────────────────────────────────────────────────────────
    {
      id: 'arc-arrival',
      act: 2,
      title: 'The Library Under the Water',
      location: 'sunken-archive',
      trigger: { type: 'enterLocation', location: 'sunken-archive' },
      when: { all: ['awakened'] },
      text:
        'You descend into green-gold water that decides, politely, not to drown you. Below: a library the size of a sunken city. Shelves climb out of sight through shafts of falling light; jars of captured memory glimmer in their thousands, each one a small aurora; fish drift the aisles like patrons who forgot what they came for. You are breathing because the dream says you may. Far down among the stacks, a teal lamp is moving — someone doing the rounds. Someone who has been doing the rounds for a very long time.',
      focusText:
        'Anchored, you understand the shelving system all at once, the way you understand things in dreams: it is sorted by ache. Gentle losses near the surface — misplaced names, faded tunes. The deeper aisles hold heavier things. And the light from the lowest stacks, miles down, is the color of the one memory nobody has ever been brave enough to file properly.',
      effects: [
        {
          type: 'journal',
          category: 'story',
          title: 'The Sunken Archive',
          text: 'A drowned library where every memory the waking world loses is shelved in jars of light. A keeper still does the rounds.',
        },
      ],
    },
    {
      id: 'arc-thessaly-1',
      act: 2,
      title: 'The Archivist',
      location: 'sunken-archive',
      speaker: 'thessaly',
      trigger: { type: 'interact', objectId: 'arc_echo_thessaly' },
      when: { none: ['thessaly-1'] },
      text:
        '“Mind the third shelf. It bites.” The Echo turns: teal light in the shape of a woman, ink-dark hair drifting on the current, a lamp in one hand and a ledger in the other. “Thessaly. Archivist. You’ll be the walkers the whole Veil is whispering about — we’re saved, then, or at least about to be better catalogued.” She looks you over the way she might assess a water-damaged folio: gently, and without much hope. “Everything the waking world loses washes down to me. Lost names. Lost tunes. Lost dreams — yes, yours are here somewhere. Touch nothing that glows red.”',
      effects: [
        { type: 'setFlag', flag: 'thessaly-1' },
        { type: 'relationship', npcId: 'thessaly', delta: 1 },
      ],
    },
    {
      id: 'arc-thessaly-2',
      act: 2,
      title: 'The Sealed Stacks',
      location: 'sunken-archive',
      speaker: 'thessaly',
      trigger: { type: 'interact', objectId: 'arc_echo_thessaly' },
      when: { all: ['thessaly-1'], none: ['thessaly-2'] },
      text:
        'Thessaly’s lamp dips. “When the Hush came flooding through I sealed the stacks — three glyph-locks, made to need more hands than I have. It cost me the library to save the library; I have been keeper of a closed book ever since.” She straightens. “Open them together and the Archive breathes again. But understand what else you’ll wake. Beneath the reading room is the Memory Pool, and at the bottom of the pool lies the Dreamer’s first memory. The oldest thing in the Veil. I have never read it. Ask me why and I will tell you to shush.”',
      focusText:
        'In the anchored quiet she says it anyway. “I filed my own waking life, you know. Every morning of it, jar by jar, so I would never have to miss it. Somewhere in nine hundred fathoms of shelving is the person I was before the Archive.” The lamp does not waver. Her voice does. “I no longer remember which jar. And I have never let myself search, because an archivist who opens jars for her own sake is no archivist at all.”',
      effects: [
        { type: 'setFlag', flag: 'thessaly-2' },
        {
          type: 'journal',
          category: 'clue',
          title: 'Three glyph-locks',
          text: 'Thessaly sealed the stacks behind three glyph-locks that need many hands at once. Opening them wakes the Archive — and the Memory Pool beneath the reading room.',
        },
      ],
    },
    {
      id: 'arc-tablet',
      act: 2,
      title: 'The Library Oath',
      location: 'sunken-archive',
      trigger: { type: 'interact', objectId: 'arc_lore_tablet' },
      text:
        'A tablet of pale stone, older than the shelves around it, the dream-script flowing and re-flowing under your eyes until it consents to be read: WE KEEP WHAT THE WAKING LOSE, AGAINST THE MORNING THEY WANT IT BACK. Below the oath, a long column of signatures in a hundred hands and brightnesses — every archivist who ever served. The last signature is Thessaly’s, firm and clear. After it, an empty space has been left. The stone is patient about it, the way the loom is patient. The Veil keeps leaving room.',
      effects: [
        {
          type: 'journal',
          category: 'lore',
          title: 'The Library Oath',
          text: '“We keep what the waking lose, against the morning they want it back.” Every archivist signed. After Thessaly’s name, the stone leaves room.',
        },
      ],
    },
    {
      id: 'arc-orrery',
      act: 2,
      title: 'The Orrery of the Veil',
      location: 'sunken-archive',
      trigger: { type: 'interact', objectId: 'arc_lore_orrery' },
      text:
        'In a drowned rotunda turns an orrery of the whole Veil: six lights wheeling on rings of brass — harbor, city, archive, wood, mere, and one bright wanderer that must be you, because it moves when you do. At the center, where an orrery should hang its sun, there is instead a small dark sphere. You check the maker’s plate, expecting an answer, and get one: BUILT IN THE FIRST MORNING. The dark was at the center before the Hush ever had a name. The Veil was dreamed around a sorrow, not invaded by one.',
      effects: [
        {
          type: 'journal',
          category: 'lore',
          title: 'The dark at the center',
          text: 'The Archive’s orrery, built in the first morning, holds a small dark sphere where its sun should be. The Veil was dreamed around a sorrow — not invaded by one.',
        },
      ],
    },
    {
      id: 'arc-glyphs',
      act: 2,
      title: 'The Stacks Unsealed',
      location: 'sunken-archive',
      trigger: {
        type: 'allInteract',
        objectIds: ['arc_glyph_1', 'arc_glyph_2', 'arc_glyph_3'],
        windowMs: 30000,
      },
      text:
        'Three locks turn as one, and the Archive inhales. Currents wake down every aisle; ten thousand memory-jars kindle shelf by shelf until the deep glows like a city seen from a night ship; the third shelf bites no one, out of sheer surprise. Books that waited centuries fan themselves open overhead like rays. And beneath the reading room a floor of mosaic slides back from a well of absolutely still water — the Memory Pool, lit from below by one small sunken light, like a coin at the bottom of a wish.',
      focusText:
        'Anchored amid the waking shelves, you hear the Archive’s own voice for a moment — not words: the sound of ten thousand memories being kept, which is almost exactly the sound of rain on a roof you are safe under. Underneath it, from the pool, one small light pulses. Patient. Very old. The first thing the Dreamer ever needed someone else to hold.',
      effects: [
        { type: 'setFlag', flag: 'archive-attuned' },
        {
          type: 'journal',
          category: 'clue',
          title: 'The Memory Pool',
          text: 'The stacks are unsealed and the Archive breathes. Beneath the reading room, the Memory Pool lies open — the Dreamer’s first memory waiting at the bottom.',
        },
      ],
    },
    {
      id: 'arc-pool',
      act: 2,
      title: 'The First Memory',
      location: 'sunken-archive',
      speaker: 'thessaly',
      trigger: { type: 'interact', objectId: 'arc_memory_pool' },
      when: { all: ['archive-attuned'] },
      text:
        'It drifts at the bottom of the pool, small as a coin: the Dreamer’s first memory, from before the first morning, from before there was anyone to remember with. The water above it is so still it aches. Thessaly stands at the rim, lamp low. “Knowing is my whole faith,” she says. “Every jar in this place is a promise that nothing true should be lost. And still, in nine hundred years, I never opened this one.” She looks up at you, and for once the dryness is gone. “Choose better than I could. Either way — choose.”',
      choice: {
        id: 'memory-pool',
        prompt: 'The Dreamer’s first memory lies at the bottom of the pool. Does the party read it?',
        durationMs: 60000,
        options: [
          {
            id: 'read',
            label: 'Read it',
            description:
              'Surface the first memory and witness it together. Truth, whatever it costs — and whatever it asks of you afterward.',
          },
          {
            id: 'seal',
            label: 'Seal it',
            description:
              'Some pages are doors locked from the inside. Guard it unread, and give the Dreamer the only privacy they have left.',
          },
        ],
      },
      effects: [{ type: 'mood', mood: 'tension' }],
    },
    {
      id: 'arc-echo-read',
      act: 2,
      title: 'What the Water Held',
      location: 'sunken-archive',
      speaker: 'thessaly',
      trigger: { type: 'choiceResolved', choiceId: 'memory-pool', optionId: 'read' },
      text:
        'The memory rises and opens over the pool, and you witness it together: dark. Not cruel dark — empty dark, before anything. And in it, someone alone, so wholly alone that the word had not been invented, who said into the nothing: let there be somewhere, so the dark can have someone in it. The Veil was not built. It was company. The vision folds away and Thessaly is weeping the way librarians weep — silently, with excellent posture. “Nine hundred years I guarded that,” she says. “It was a love letter. File it under everything.” The Archive — and its Archivist — come fully, finally alight.',
      effects: [
        { type: 'setFlag', flag: 'echo-archive' },
        { type: 'relationship', npcId: 'thessaly', delta: 1 },
        { type: 'giveItem', itemId: 'memory-drop', to: 'all' },
        { type: 'mood', mood: 'hopeful' },
        {
          type: 'journal',
          category: 'story',
          title: 'The Echo of the Archive',
          text: 'We read the first memory. The Veil was dreamed as company against the dark. Thessaly and her Archive are restored — and now we know what the Dreamer is protecting.',
        },
      ],
    },
    {
      id: 'arc-echo-seal',
      act: 2,
      title: 'The Kept Page',
      location: 'sunken-archive',
      speaker: 'thessaly',
      trigger: { type: 'choiceResolved', choiceId: 'memory-pool', optionId: 'seal' },
      text:
        'Together you draw the mosaic floor back over the pool, and the party seals the oldest thing in the Veil away unread. The small light below seems to settle as the dark closes over it — like a sleeper turning toward a wall, trusted at last. Thessaly watches the last tile fit home, and something nine hundred years tight in her shoulders lets go. “I have spent my whole service afraid that not-knowing was a failure of nerve,” she says. “Thank you for making it look like what it was. Like keeping.” The Archive exhales around you, shelf-light steadying — whole, and warm, and certain of its keeper.',
      effects: [
        { type: 'setFlag', flag: 'echo-archive' },
        { type: 'relationship', npcId: 'thessaly', delta: 2 },
        { type: 'giveItem', itemId: 'memory-drop', to: 'all' },
        { type: 'mood', mood: 'hopeful' },
        {
          type: 'journal',
          category: 'story',
          title: 'The Echo of the Archive',
          text: 'We sealed the first memory unread, and gave the Dreamer their privacy. Thessaly and the Archive are restored. Some keeping is its own kind of knowing.',
        },
      ],
    },
    {
      id: 'gift-chronicler',
      act: 2,
      title: 'The Page That Writes Back',
      location: 'sunken-archive',
      trigger: { type: 'interact', objectId: 'arc_hidden_chronicler' },
      text:
        'To the others it is a wall of blur — dream-script, sliding off every eye but yours. You read it easily, the way you have always read what people forget on waking. It is a letter. It is addressed to you, by trade if not by name: TO THE ONE WHO CARRIES THE BLANK BOOKS. WE KNOW THEY GROW HEAVIER. IT IS US, WRITING BACK. KEEP CARRYING THEM. One page detaches itself from the wall like a leaf deciding on autumn, and folds into your satchel, where it has clearly always belonged.',
      effects: [
        { type: 'setFlag', flag: 'gift-chronicler' },
        { type: 'giveItem', itemId: 'unwritten-page', to: 'interactor' },
        { type: 'relationship', npcId: 'thessaly', delta: 1 },
        {
          type: 'journal',
          category: 'lore',
          title: 'Writing back',
          text: 'Our Chronicler read the dream-script the rest of us see as blur. The heaviness of the blank books has an author — and it sent a page home with them.',
        },
      ],
    },
    {
      id: 'gift-tidecaller',
      act: 2,
      title: 'What the Deep Kept',
      location: 'sunken-archive',
      trigger: { type: 'interact', objectId: 'arc_hidden_tidecaller' },
      text:
        'The deep water has been trying to get your attention since you arrived — a pressure against the ear, a name said in current. You follow it below the lowest shelf, where the light gives up and the sea remembers it is sea. There, held in a cradle of stone, the deep gives back what it kept safe: a pearl with a lullaby still circling inside, sung once over dark water by someone who thought no one heard. The sea kept your secrets. You kept its. This, you understand, is the receipt.',
      effects: [
        { type: 'setFlag', flag: 'gift-tidecaller' },
        { type: 'giveItem', itemId: 'tide-pearl', to: 'interactor' },
        { type: 'relationship', npcId: 'thessaly', delta: 1 },
        {
          type: 'journal',
          category: 'lore',
          title: 'The deep’s receipt',
          text: 'Below the lowest shelf, the deep gave our Tidecaller a pearl with a lullaby inside — something it had kept safe for exactly this long.',
        },
      ],
    },
    // ───────────────────────────────────────────────────────────────────
    // ACT 2 — The Wandering Wood
    // ───────────────────────────────────────────────────────────────────
    {
      id: 'wood-arrival',
      act: 2,
      title: 'The Forest That Walks',
      location: 'wandering-wood',
      trigger: { type: 'enterLocation', location: 'wandering-wood' },
      when: { all: ['awakened'] },
      text:
        'The road delivers you into a forest that is, very slowly, going somewhere. Trees stride at the pace of seasons; paths reshuffle with a courteous rustle, like a deck offering you a card; lantern-fruit sways from branches that were not there when you blinked. Nothing here is lost. Everything here is looking. High overhead the canopy keeps parting, deliberately, on the same patch of sky — as if the whole wood were checking, again and again, whether someone it waits for is on their way back.',
      focusText:
        'Anchored, you feel the rhythm under the soil: the wood is not wandering at random. It walks a search pattern, old and patient and very thorough, the way you search for something you have promised yourself you will not cry about until you find it.',
      effects: [
        {
          type: 'journal',
          category: 'story',
          title: 'The Wandering Wood',
          text: 'A forest that walks, slowly, in a search pattern. Nothing here is lost — everything here is looking.',
        },
      ],
    },
    {
      id: 'wood-rowan-1',
      act: 2,
      title: 'The Warden',
      location: 'wandering-wood',
      speaker: 'rowan',
      trigger: { type: 'interact', objectId: 'wood_echo_rowan' },
      when: { none: ['rowan-1'] },
      text:
        'The figure leaning on the waystone is green light grown over with real bark, patient as weather. “Rowan. Warden. You’re late, but so is everyone — the wood moves the door.” They nod at the striding trees. “She’s walked for years now. Looking for the laughter, I reckon. The Dreamer used to laugh, and the whole forest would fruit out of season. No laughter in a long while. And now there’s gray got into the Heartwood — the one tree I cannot lose.” A pause, like a root settling. “Could use hands. Could use hands that mean it.”',
      effects: [
        { type: 'setFlag', flag: 'rowan-1' },
        { type: 'relationship', npcId: 'rowan', delta: 1 },
      ],
    },
    {
      id: 'wood-rowan-2',
      act: 2,
      title: 'The Three Waystones',
      location: 'wandering-wood',
      speaker: 'rowan',
      trigger: { type: 'interact', objectId: 'wood_echo_rowan' },
      when: { all: ['rowan-1'], none: ['rowan-2'] },
      text:
        '“Here’s the work. Three waystones keep the wood from wandering clean off the map — and she’s pulled them loose with all her pacing. Wake them together, all three at once, and she’ll stand still long enough to be helped.” Rowan thumps the stone beside them, fond as you’d pat an ox. “When she stills, the Heartwood will let you near. Fair warning, walkers: I’ve had ten years to deal with what you’ll find there, and I’ve spent them standing very still myself. Don’t let me do it an eleventh.”',
      focusText:
        'Anchored, you ask the question no one asked aloud, and Rowan answers it, eyes on the canopy. “Planted the Heartwood with someone. Two saplings twisted into one trunk — her idea. Then one morning she woke, the way your kind do, and didn’t come back, the way her kind mostly don’t. The tree’s the promise neither of us said out loud. So no. I can’t be the one who puts a blade to it. Even the sick limb. Even now.”',
      effects: [
        { type: 'setFlag', flag: 'rowan-2' },
        {
          type: 'journal',
          category: 'clue',
          title: 'Wake the waystones',
          text: 'Rowan: wake the three waystones at once to still the wandering wood. Then the Heartwood — gray creeping through it — will let us approach.',
        },
      ],
    },
    {
      id: 'wood-stump',
      act: 2,
      title: 'The Oldest Stump',
      location: 'wandering-wood',
      trigger: { type: 'interact', objectId: 'wood_lore_stump' },
      text:
        'A stump wide as a cottage floor, polished by generations of sitters, its rings readable as a calendar of the whole dream. Here, a ring of fire-years, dark and thin. Here, a broad bright band — someone carved beside it, in tiny letters, the laughing years. The outermost rings tell the recent story plainly: thin, gray-tinged, each year closer-pressed than the last, like handwriting running out of page. The very newest ring, though — this year’s, still tender at the rim — has the faintest blush of green to it. The wood heard you coming.',
      effects: [
        {
          type: 'journal',
          category: 'lore',
          title: 'A calendar of rings',
          text: 'The oldest stump records the dream’s whole history in rings — laughing years, fire-years, the thin gray recent ones. This year’s ring shows new green.',
        },
      ],
    },
    {
      id: 'wood-waystones',
      act: 2,
      title: 'The Wood Stands Still',
      location: 'wandering-wood',
      trigger: {
        type: 'allInteract',
        objectIds: ['wood_waystone_1', 'wood_waystone_2', 'wood_waystone_3'],
        windowMs: 30000,
      },
      text:
        'Three waystones wake under your hands, and the forest comes to rest the way a great ship comes to harbor — slow, vast, sighing along its whole green length. Paths settle and agree with one another. Lantern-fruit steadies. Petals come down for a full minute, a pink-gold snowfall of relief. And in the sudden stillness you can finally see it: at the heart of the wood, a tree like a held breath, one great limb gone gray as glass. The thorn-hedge around it loosens, and parts, and lets you pass.',
      focusText:
        'In the anchored stillness you feel what the wood feels: not exhaustion — release. It walked so long because stopping meant being findable, and being findable meant the gray could find the rest of it. It has decided to trust you instead. The whole forest, root to crown, is holding still on purpose, for the first time in ten years, because you are here.',
      effects: [
        { type: 'setFlag', flag: 'wood-attuned' },
        {
          type: 'journal',
          category: 'clue',
          title: 'The Heartwood waits',
          text: 'The waystones woke and the wood stands still — trusting us. The thorn-hedge has parted around the Heartwood and its gray limb.',
        },
      ],
    },
    {
      id: 'wood-heartwood',
      act: 2,
      title: 'The Heartwood',
      location: 'wandering-wood',
      speaker: 'rowan',
      trigger: { type: 'interact', objectId: 'wood_heartwood' },
      when: { all: ['wood-attuned'] },
      text:
        'Two saplings, twisted long ago into one great trunk: the Heartwood. Its canopy holds an evening’s worth of stars among the leaves, and its sap runs in slow veins of light — except along the northern limb, where everything has gone gray, translucent, Hush-glassed to the bough. The gray is patient. It is an inch further than it was this morning. Rowan stands at the thorn-line, not crossing it. “Ten years I’ve stood here not choosing,” they say. “Turns out that’s also a choice, and it’s been the wrong one. So. Choose with me.”',
      choice: {
        id: 'heartwood',
        prompt: 'The Hush has taken the Heartwood’s northern limb. What does the party do?',
        durationMs: 60000,
        options: [
          {
            id: 'prune',
            label: 'Prune the limb',
            description:
              'Cut the gray away clean. Certain, and forever — the tree keeps its life, and loses a hundred years of growing.',
          },
          {
            id: 'nurture',
            label: 'Nurture it through',
            description:
              'Pour your light into the sick limb and ask it to remember blossom. If it works, nothing is lost. If it fails, the gray spreads.',
          },
        ],
      },
      effects: [{ type: 'mood', mood: 'tension' }],
    },
    {
      id: 'wood-echo-prune',
      act: 2,
      title: 'The Clean Cut',
      location: 'wandering-wood',
      speaker: 'rowan',
      trigger: { type: 'choiceResolved', choiceId: 'heartwood', optionId: 'prune' },
      text:
        'Rowan makes the cut themself — they insist on that — one clean stroke with a blade of green light, and the gray limb comes away and crumbles into harmless frost. The whole wood shudders, once, and is still. Where the limb was, the trunk seals itself in scar-bark of pale silver, and even before your eyes the scar puts out one small, defiant blossom. “A hundred years of growing,” Rowan says, hand flat on the trunk, steady at last. “Gone. And she lives. Some healing looks like loss for a while. I can keep a tree company through that.” The Echo of the Wood stands whole.',
      effects: [
        { type: 'setFlag', flag: 'echo-wood' },
        { type: 'relationship', npcId: 'rowan', delta: 1 },
        { type: 'giveItem', itemId: 'heartwood-seed', to: 'all' },
        { type: 'mood', mood: 'hopeful' },
        {
          type: 'journal',
          category: 'story',
          title: 'The Echo of the Wood',
          text: 'Rowan cut the Hush-glassed limb away clean. The Heartwood lives, silver-scarred, already blossoming at the wound. The wood and its Warden are restored.',
        },
      ],
    },
    {
      id: 'wood-echo-nurture',
      act: 2,
      title: 'Asked to Remember Blossom',
      location: 'wandering-wood',
      speaker: 'rowan',
      trigger: { type: 'choiceResolved', choiceId: 'heartwood', optionId: 'nurture' },
      text:
        'You lay your hands on the gray together and pour in everything you have — lantern-warmth, song, stubbornness, the particular light of people who came a long way on purpose. For a terrible minute the gray climbs your wrists. Rowan steps over the thorn-line at last and adds their hands to yours. And the limb remembers. Glass softens to bark; sap kindles down the old veins; and the northern bough breaks into blossom in colors that do not have names yet, because nothing has ever bloomed after the Hush before. Rowan is laughing. The whole forest is fruiting out of season.',
      effects: [
        { type: 'setFlag', flag: 'echo-wood' },
        { type: 'relationship', npcId: 'rowan', delta: 2 },
        { type: 'giveItem', itemId: 'heartwood-seed', to: 'all' },
        { type: 'mood', mood: 'hopeful' },
        {
          type: 'journal',
          category: 'story',
          title: 'The Echo of the Wood',
          text: 'We poured our light into the gray limb and it remembered blossom — colors with no names yet. The Heartwood is whole, and Rowan crossed the thorn-line at last.',
        },
      ],
    },
    {
      id: 'gift-thornwalker',
      act: 2,
      title: 'The Debt of Paths',
      location: 'wandering-wood',
      trigger: { type: 'interact', objectId: 'wood_hidden_thornwalker' },
      text:
        'The bramble wall is impassable, and then it sees you, and it is not. Thorns unhook themselves with something like embarrassment; a green door opens in the hedge that no map has ever held. Beyond, in a glade the size of a kept secret, the wood pays its debt: a charm of living briar, knotted by no hands, grown for you specifically — the forest equivalent of a letter long unsent. You spared a wood once that meant you harm. Word, apparently, travels between forests. Word, apparently, never stopped.',
      effects: [
        { type: 'setFlag', flag: 'gift-thornwalker' },
        { type: 'giveItem', itemId: 'thorn-charm', to: 'interactor' },
        { type: 'relationship', npcId: 'rowan', delta: 1 },
        {
          type: 'journal',
          category: 'lore',
          title: 'The green door',
          text: 'The hedge opened a door for our Thornwalker that exists on no map, and paid an old debt with a charm of living briar.',
        },
      ],
    },
    {
      id: 'gift-warden',
      act: 2,
      title: 'The Hungry Ward',
      location: 'wandering-wood',
      trigger: { type: 'interact', objectId: 'wood_hidden_warden' },
      text:
        'You feel it before you find it, the way you always do: a guardian-stone, half-swallowed by moss, its ward worn down to a flicker. It has stood this watch alone for centuries — circled, outnumbered, unfed — and it has not once stepped back. Kin, then. You kneel and feed the ward the way the old watch taught: a little vigilance, a little warmth, the promise that someone will come when it calls. The stone drinks deep and blazes green, and its circle of safety rolls outward through the trees like a sigh of relief.',
      effects: [
        { type: 'setFlag', flag: 'gift-warden' },
        { type: 'giveItem', itemId: 'ward-knot', to: 'interactor' },
        { type: 'relationship', npcId: 'rowan', delta: 1 },
        {
          type: 'journal',
          category: 'lore',
          title: 'The ward renewed',
          text: 'Our Dreamwarden found a guardian-stone that had held its watch alone for centuries, and fed its ward back to full flame.',
        },
      ],
    },
    // ───────────────────────────────────────────────────────────────────
    // ACT 2 — The Mirrormere (optional: lore & relationships)
    // ───────────────────────────────────────────────────────────────────
    {
      id: 'mir-arrival',
      act: 2,
      title: 'The Lake That Looks Back',
      location: 'mirrormere',
      trigger: { type: 'enterLocation', location: 'mirrormere' },
      when: { all: ['awakened'] },
      text:
        'A lake so still it embarrasses the sky into stillness too. The Mirrormere does not ripple; it considers. Your reflections arrive a half-step after you do, straightening their collars as if they came a longer way, and when you raise a hand in greeting, some of them are already waving. The shore is glass-pebbled, the air is the temperature of held breath, and the silence here is nothing like the Hush. This silence is listening. This whole place is one enormous act of paying attention.',
      focusText:
        'Anchored at the waterline, you catch the mere doing its real work: every star, every lantern, every face it has ever reflected is still in there, kept. The lake is not showing you yourself. It is showing the Dreamer everything — gently, at one remove, the only way the sleeping can bear to look.',
      effects: [
        {
          type: 'journal',
          category: 'story',
          title: 'The Mirrormere',
          text: 'A perfectly still lake that keeps everything it reflects. Our reflections wave first here. Something in the water pays attention.',
        },
      ],
    },
    {
      id: 'mir-reflection-1',
      act: 2,
      title: 'The Dreamer’s Reflection',
      location: 'mirrormere',
      speaker: 'reflection',
      trigger: { type: 'interact', objectId: 'mir_echo_reflection' },
      when: { none: ['reflection-1'] },
      text:
        'It rises from the water without disturbing it: a figure of pale light that wears, in slow turns, each of your faces — kindly, like trying on coats it admires. “You are wondering what I am,” it says, in slow turns of each of your voices. “I am what the Dreamer sees when the water is kind. They cannot look at themselves anymore, you understand. So I do the looking, and I keep it gentle.” It tilts a head that is currently yours. “You came a long way to save someone you have never met. May I ask why? I collect the answers.”',
      effects: [
        { type: 'setFlag', flag: 'reflection-1' },
        { type: 'relationship', npcId: 'reflection', delta: 1 },
      ],
    },
    {
      id: 'mir-reflection-2',
      act: 2,
      title: 'Where the Water Goes',
      location: 'mirrormere',
      speaker: 'reflection',
      trigger: { type: 'interact', objectId: 'mir_echo_reflection' },
      when: { all: ['reflection-1'], none: ['reflection-2'] },
      text:
        '“You have met the Hush by now. Everyone asks me what it is. Very well.” The Reflection kneels and touches the water, and the water lets it. “When you cry in a dream — where does the water go? Here. It comes here. I keep it. That is allowed; that is healthy, even.” It looks up, wearing the face of whoever among you looks saddest. “But when you refuse to cry at all — for years, for ages, because everyone you make mornings for gets taken by the morning — the tears that are never cried go somewhere too. They go quiet. They go Hush. The Dreamer is not under attack, walkers. The Dreamer is winning an argument with their own grief, and losing everything else.”',
      focusText:
        'Anchored, you realize the Reflection has stopped wearing your faces. For one still moment it wears its own — and its own face is the Dreamer’s, young and tired and hopeful, the way they looked on the first morning. “One more answer I will give for free,” it says softly. “They know you are here. It is the first thing they have looked at in a hundred years. What will you do after you have saved everything? Think on it. The water will hold your answer until they are ready to find it.”',
      effects: [
        { type: 'setFlag', flag: 'reflection-2' },
        {
          type: 'journal',
          category: 'lore',
          title: 'What the Hush is',
          text: 'The Reflection: tears cried in dreams flow to the Mirrormere. Tears refused for ages go quiet instead — go Hush. The Dreamer is losing to their own unwept grief.',
        },
      ],
    },
    {
      id: 'mir-shore',
      act: 2,
      title: 'The Glass Shore',
      location: 'mirrormere',
      trigger: { type: 'interact', objectId: 'mir_lore_shore' },
      text:
        'The shore is pebbled with smooth glass, and every pebble holds an image the lake decided to keep: a face mid-laugh; two hands meeting over a market stall; a dog of improbable size asleep in sunlight; a window, lit, seen from a cold road. Thousands of them, sorted by no system except cherishing. You understand, turning one in your palm, that this is the Dreamer’s favorite shelf — the moments worth polishing for a century. The pebble in your hand grows warm. Gently, deliberately, the lake is showing you that it keeps yours, too.',
      effects: [
        {
          type: 'journal',
          category: 'lore',
          title: 'The lake’s keepsakes',
          text: 'The Mirrormere’s shore is pebbled with kept moments, polished for centuries. It keeps ours as well. It wanted us to know.',
        },
      ],
    },
    {
      id: 'mir-pool',
      act: 2,
      title: 'The Still Pool',
      location: 'mirrormere',
      speaker: 'reflection',
      trigger: { type: 'interact', objectId: 'mir_still_pool' },
      text:
        'Set back from the shore lies a pool the mere keeps for best: water so calm it forgets to reflect, and shows instead. The Reflection attends without being called. “This is the kind eye itself,” it says. “Two boons it can give, and it can only give one. Look in, and see your party as the Dreamer sees you — there are no flattering angles, only true ones, and people walk away changed. Or give: each of you, one true memory of your own into the water, so the dream can hold something real while it fights. Take your time. The pool has never once hurried.”',
      choice: {
        id: 'still-pool',
        prompt: 'The Still Pool offers one boon. What does the party choose?',
        durationMs: 45000,
        options: [
          {
            id: 'gaze',
            label: 'Gaze into it',
            description:
              'See yourselves as the Dreamer sees you — no flattering angles, only true ones — and carry that seeing with you.',
          },
          {
            id: 'offer',
            label: 'Make an offering',
            description:
              'Each give one true memory of your own into the water, so the dream holds something real of yours while it fights.',
          },
        ],
      },
    },
    {
      id: 'mir-boon',
      act: 2,
      title: 'The Pool Accepts',
      location: 'mirrormere',
      speaker: 'reflection',
      trigger: { type: 'choiceResolved', choiceId: 'still-pool' },
      text:
        'The pool takes what you bring it the way water takes light — entirely, and without spilling a drop. For a long moment the surface holds your choice suspended, turning it the way the lake turns its glass pebbles: this one is worth polishing; this one we will keep for a century. When you step back from the rim, the Veil holds your weight differently — surer, closer, like a bed remade while you stood at the window. “There,” says the Reflection, satisfied, wearing each of your faces once, in farewell, like a toast going around a table. “Now the dream knows you. Whatever happens at the Heart — it will not let go of you by accident.”',
      effects: [
        { type: 'relationship', npcId: 'reflection', delta: 2 },
        { type: 'giveItem', itemId: 'still-water', to: 'all' },
        { type: 'mood', mood: 'hopeful' },
        {
          type: 'journal',
          category: 'story',
          title: 'The pool’s boon',
          text: 'The Still Pool accepted what we brought it. The dream knows us now, and holds us more surely for it.',
        },
      ],
    },
    {
      id: 'gift-veilseer',
      act: 2,
      title: 'Through the Hush',
      location: 'mirrormere',
      trigger: { type: 'interact', objectId: 'mir_hidden_veilseer' },
      text:
        'At the mere’s far edge hangs a patch of Hush the others cannot even look at — their eyes slide off it like rain off glass. Yours don’t. Yours never have. You walk into the stillness, and for the first time in your seam-eyed life you see the inside of the quiet: not empty. Curled at its center, perfectly kept, is one small true thing — the sound of the Dreamer’s laugh, hidden here where grief could guard it. The Hush watches you take a lens of its own cooled silence. It does not stop you. It has been looking back at you for years, after all. It knows what you are: the only one who ever looked at it without flinching.',
      effects: [
        { type: 'setFlag', flag: 'gift-veilseer' },
        { type: 'giveItem', itemId: 'hush-glass', to: 'interactor' },
        { type: 'relationship', npcId: 'reflection', delta: 1 },
        {
          type: 'journal',
          category: 'lore',
          title: 'Inside the quiet',
          text: 'Our Veilseer walked into the Hush itself and found, kept safe at its center, the sound of the Dreamer’s laugh. The Hush guards what it cannot grieve.',
        },
      ],
    },
    // ───────────────────────────────────────────────────────────────────
    // The act-3 gate: fires when any 2 of the 3 echo flags are set.
    // FlagExpr cannot count, so each echo pair gets a beat sharing the same
    // prose; `none: ['act3-open']` guarantees exactly one ever fires.
    // ───────────────────────────────────────────────────────────────────
    {
      id: 'a3-gate-ca',
      act: 2,
      title: GATE_TITLE,
      speaker: 'hush',
      trigger: { type: 'flags' },
      when: { all: ['echo-caelis', 'echo-archive'], none: ['act3-open'] },
      text: GATE_TEXT,
      focusText: GATE_FOCUS,
      effects: [
        { type: 'setFlag', flag: 'act3-open' },
        { type: 'unlockLocation', location: 'heart-of-the-veil' },
        { type: 'setAct', act: 3 },
        { type: 'mood', mood: 'tension' },
        {
          type: 'journal',
          category: 'story',
          title: 'The way down is open',
          text: 'With two Echoes restored, a pale stair has opened toward the Heart of the Veil. The Hush is gathering there — not to fight. To finish. A third Echo still waits, if we will go for them first.',
        },
      ],
    },
    {
      id: 'a3-gate-cw',
      act: 2,
      title: GATE_TITLE,
      speaker: 'hush',
      trigger: { type: 'flags' },
      when: { all: ['echo-caelis', 'echo-wood'], none: ['act3-open'] },
      text: GATE_TEXT,
      focusText: GATE_FOCUS,
      effects: [
        { type: 'setFlag', flag: 'act3-open' },
        { type: 'unlockLocation', location: 'heart-of-the-veil' },
        { type: 'setAct', act: 3 },
        { type: 'mood', mood: 'tension' },
        {
          type: 'journal',
          category: 'story',
          title: 'The way down is open',
          text: 'With two Echoes restored, a pale stair has opened toward the Heart of the Veil. The Hush is gathering there — not to fight. To finish. A third Echo still waits, if we will go for them first.',
        },
      ],
    },
    {
      id: 'a3-gate-aw',
      act: 2,
      title: GATE_TITLE,
      speaker: 'hush',
      trigger: { type: 'flags' },
      when: { all: ['echo-archive', 'echo-wood'], none: ['act3-open'] },
      text: GATE_TEXT,
      focusText: GATE_FOCUS,
      effects: [
        { type: 'setFlag', flag: 'act3-open' },
        { type: 'unlockLocation', location: 'heart-of-the-veil' },
        { type: 'setAct', act: 3 },
        { type: 'mood', mood: 'tension' },
        {
          type: 'journal',
          category: 'story',
          title: 'The way down is open',
          text: 'With two Echoes restored, a pale stair has opened toward the Heart of the Veil. The Hush is gathering there — not to fight. To finish. A third Echo still waits, if we will go for them first.',
        },
      ],
    },
    {
      id: 'all-echoes',
      act: 2,
      title: 'The Chord Complete',
      trigger: { type: 'flags' },
      when: { all: ['echo-caelis', 'echo-archive', 'echo-wood'] },
      text:
        'Three songs rise from three far places and find each other over the cloud-sea — Caelis’s chord, the Archive’s rain-hush of kept things, the Wood’s green and growing hum — and braid. The whole Veil rings with it, gently, the way a glass rings when a friend runs a finger round the rim. At the Skyharbor, the Loom of Echoes pulls its three mended threads taut and begins to weave gold. Whatever waits at the Heart will hear you coming now. All of you. The entire, unbroken chord of you.',
      effects: [
        { type: 'setFlag', flag: 'all-echoes' },
        { type: 'mood', mood: 'hopeful' },
        { type: 'relationship', npcId: 'serai', delta: 1 },
        {
          type: 'journal',
          category: 'story',
          title: 'All three Echoes',
          text: 'Caelis, the Archive, and the Wood — all three Echoes restored, their songs braided into one chord. The Loom weaves gold. We go to the Heart complete.',
        },
      ],
    },
    // ───────────────────────────────────────────────────────────────────
    // ACT 3 — The Heart of the Veil
    // ───────────────────────────────────────────────────────────────────
    {
      id: 'a3-arrival',
      act: 3,
      title: 'The Heart of the Veil',
      location: 'heart-of-the-veil',
      trigger: { type: 'enterLocation', location: 'heart-of-the-veil' },
      when: { all: ['act3-open'] },
      text:
        'The pale stair winds down past the roots of every place you have saved — harbor-light above, a green hem of forest, the deep glow of shelved memories — into a hollow vaster than sky. Here the dream wears thin as breath on glass; you can feel the waking world through the floor, distant as a street heard from a warm bed. And at the center, on a dais of woven light, the First Dreamer sleeps: vast and human-small at once, curled around a small dark star, holding it the way you hold what you cannot look at and cannot put down. The Hush stands everywhere around them. It does not move. It is not a guard. It is grief, waiting to be the only thing left.',
      focusText:
        'Anchored at the rim of the hollow, you feel the rhythm of the place at last: the slow pulse from the fountain of Caelis, the breath the harbor breathes — it all starts here. One heart, beating too slowly, dreaming six worlds and you in them. Each beat is a choice to continue. Each gap between beats is longer than the last.',
      effects: [
        {
          type: 'journal',
          category: 'story',
          title: 'The Heart',
          text: 'At the bottom of the pale stair, the First Dreamer sleeps curled around a small dark star — their own grief. The Hush waits around them. The dream is thin here.',
        },
      ],
    },
    {
      id: 'a3-dreamer-1',
      act: 3,
      title: 'The Sleeper Speaks',
      location: 'heart-of-the-veil',
      speaker: 'dreamer',
      trigger: { type: 'interact', objectId: 'heart_dreamer' },
      when: { none: ['dreamer-1'] },
      text:
        'The Dreamer does not wake. The Dreamer speaks anyway, the way thunder speaks from a sky already moved on — vast, slow, and impossibly gentle: “You are the ones who swore to my Loom. I felt it, like a hand taking the other end of something heavy.” The dark star turns against their chest. “Forgive the quiet. It is mine; I made it; I feed it everything I cannot bear. You have sung pieces of it home — I felt that too. It hurt. It hurt the way thawing hurts. Come closer, Veilwalkers. Let me look at you with my eyes shut.”',
      effects: [
        { type: 'setFlag', flag: 'dreamer-1' },
        { type: 'relationship', npcId: 'dreamer', delta: 1 },
      ],
    },
    {
      id: 'a3-dreamer-2',
      act: 3,
      title: 'The Long Confession',
      location: 'heart-of-the-veil',
      speaker: 'dreamer',
      trigger: { type: 'interact', objectId: 'heart_dreamer' },
      when: { all: ['dreamer-1'], none: ['dreamer-2'] },
      text:
        '“I dreamed the Veil so the dark would have someone in it. Did you know? I dreamed harbors and forests and one very sarcastic librarian, and for an age I was not alone. But every dreamer wakes. Everyone I make mornings for, the morning takes. I never learned to grieve them — there was always another world to hold up — so the grief went quiet, and the quiet grew teeth made of nothing.” The great voice steadies itself. “I am tired, friends. Wake the five glyphs around my dais — all together, every hand. The Loom will descend and offer you my thread. What you weave with it, I will become. I trust you. It has been so long since I trusted anyone with this.”',
      focusText:
        'Closer than hearing, the Dreamer shares one memory directly: the first morning. Raw new light on raw new water, and a figure of braided gold opening her eyes for the first time — Serai, the first Echo, looking around the empty bright harbor and saying, before anything else: “Oh — you must have been so lonely. Well. Not anymore.” The memory is worn smooth at the edges, like a pebble turned a million times. It is the one the Dreamer holds when the dark star pulls hardest.',
      effects: [
        { type: 'setFlag', flag: 'dreamer-2' },
        {
          type: 'journal',
          category: 'clue',
          title: 'The final ritual',
          text: 'The Dreamer asks us to wake the five glyphs around the dais together — every hand. Then the Loom descends, and offers us the Dreamer’s own thread to weave.',
        },
      ],
    },
    {
      id: 'a3-ritual',
      act: 3,
      title: 'The Last Weave Begins',
      location: 'heart-of-the-veil',
      trigger: {
        type: 'allInteract',
        objectIds: ['heart_glyph_1', 'heart_glyph_2', 'heart_glyph_3', 'heart_glyph_4', 'heart_glyph_5'],
        windowMs: 90000,
      },
      text:
        'Five glyphs, five lights, every hand the party has — and the hollow answers like a struck bell the size of a world. Every song you returned comes flooding down the pale stair at once: the chord of Caelis, the Archive’s kept rain, the Wood’s green hum, lantern-light, mere-light, all of it braiding into a column above the sleeping Dreamer. The dark star unclenches — only a little, only enough. And down through the singing light descends the Loom of Echoes, vast now, threaded with everything that has ever happened here, one shuttle-space empty and waiting at the center of the pattern.',
      focusText:
        'Inside the column of song, anchored, you see the Hush clearly for the first and last time: not a shadow at all, up close. A figure made of held breath, kneeling beside the Dreamer the way it has knelt for ages, doing the only thing it knows — keeping the unbearable so its maker never has to carry it alone. As the light builds, it looks up at you. ( finally, says the quiet, in its language of gaps. finally someone strong enough to take this from me. )',
      effects: [
        { type: 'setFlag', flag: 'heart-ritual' },
        { type: 'mood', mood: 'climax' },
        {
          type: 'journal',
          category: 'story',
          title: 'The Loom descends',
          text: 'The five glyphs woke as one. The Loom of Echoes has descended over the sleeping Dreamer, one shuttle-space empty — waiting for what we choose to weave.',
        },
      ],
    },
    {
      id: 'a3-loom',
      act: 3,
      title: 'The Dreamer’s Thread',
      location: 'heart-of-the-veil',
      speaker: 'dreamer',
      trigger: { type: 'interact', objectId: 'heart_loom' },
      when: { all: ['heart-ritual'] },
      text:
        'The Loom lowers its shuttle into your hands, and wound upon it, warm as a pulse, is a single thread of living gold: the Dreamer, all of them, everything they are and hold and grieve, offered up with both hands open. “Weave,” says the vast slow voice, and there is no fear in it anymore, only trust heavy enough to buckle stone. “Whatever you make, make it together. That is the only instruction the first morning ever had.” The Hush gathers close to watch. The Echoes’ songs hold their note. The whole Veil leans in around you, waiting to find out what it will be when you are done.',
      choice: {
        id: 'ending',
        prompt: 'The Dreamer’s thread is in the party’s hands. What do you weave?',
        durationMs: 90000,
        options: [
          {
            id: 'wake',
            label: 'Wake the Dreamer',
            description:
              'End the long dream gently. The Veil folds into morning; everything loved here returns the only way real things do — as memory. The Dreamer goes free.',
          },
          {
            id: 'mend',
            label: 'Mend the dream',
            description:
              'Reweave the Veil whole around its Dreamer — grief and all, tended now, never carried alone again. The dream goes on, brighter, and you may always return.',
          },
          {
            id: 'become',
            label: 'Become the keepers',
            description:
              'Take up the thread yourselves. The Dreamer rests at last inside their own dream, and the party becomes what holds the Veil — its new waking-and-sleeping heart.',
          },
        ],
      },
      effects: [{ type: 'mood', mood: 'climax' }],
    },
    {
      id: 'a3-wake',
      act: 3,
      title: 'The Unbinding',
      location: 'heart-of-the-veil',
      trigger: { type: 'choiceResolved', choiceId: 'ending', optionId: 'wake' },
      text:
        'You weave an ending the way you would tuck in a child: thoroughly, and with love in every corner. The thread of gold runs back through every row of the pattern, loosening, releasing, thanking — and the Veil begins, gently, to fold. Not tearing: folding, like a letter someone intends to keep. The Echoes come down the pale stair to stand with you as the worlds gather themselves in. The dark star, unheld at last, dissolves into ordinary tears, and the Dreamer — for the first time in any age — begins, peacefully, enormously, to wake.',
      effects: [
        { type: 'mood', mood: 'hopeful' },
        {
          type: 'journal',
          category: 'story',
          title: 'We chose the morning',
          text: 'We wove the Dreamer’s thread into a waking. The Veil folds itself like a kept letter, and its maker goes free into morning.',
        },
        { type: 'ending', endingId: 'ending-wake' },
        { type: 'triggerBeat', beatId: 'a3-afterglow', delayMs: 9000 },
      ],
    },
    {
      id: 'a3-mend',
      act: 3,
      title: 'The Reweaving',
      location: 'heart-of-the-veil',
      trigger: { type: 'choiceResolved', choiceId: 'ending', optionId: 'mend' },
      text:
        'You weave the dream back into itself — but differently, this time. Where the old pattern hid its grief in a far dark corner, you weave the dark thread through every row, openly, the way menders do: visible, honored, load-bearing. The Hush comes apart with something like relief and becomes what it always should have been — rain over the Mirrormere, soft and endless and finally falling. The dark star spins itself into a hearth at the Veil’s center. The Dreamer sighs, and settles deeper, and the whole dream grows warmer by one tended sorrow. The Veil holds. The Veil, at last, is held.',
      effects: [
        { type: 'mood', mood: 'hopeful' },
        {
          type: 'journal',
          category: 'story',
          title: 'We chose the mending',
          text: 'We rewove the Veil with its grief carried openly in the pattern. The Hush fell as rain at last. The dream goes on, brighter, and we may always return.',
        },
        { type: 'ending', endingId: 'ending-mend' },
        { type: 'triggerBeat', beatId: 'a3-afterglow', delayMs: 9000 },
      ],
    },
    {
      id: 'a3-become',
      act: 3,
      title: 'The Taking Up',
      location: 'heart-of-the-veil',
      trigger: { type: 'choiceResolved', choiceId: 'ending', optionId: 'become' },
      text:
        'You weave yourselves in. One by one the party’s own threads cross the Dreamer’s gold — lantern-thread, song-thread, green and ink and ember and tide — until the pattern no longer rests on a single sleeping heart but on a circle of them, waking and sleeping in shifts, the way friends keep any long watch. The Dreamer’s thread goes slack with gratitude. They do not wake and do not vanish; they curl into their own dream like a child carried indoors at the end of a long day, safe inside the thing they made, keepers watching over them at last. The Veil settles onto your shoulders. It is lighter than any of you expected. It is shared.',
      effects: [
        { type: 'mood', mood: 'hopeful' },
        {
          type: 'journal',
          category: 'story',
          title: 'We chose the keeping',
          text: 'We wove ourselves into the pattern. The Dreamer rests inside their own dream, and the party holds the Veil now — together, in shifts, the way friends keep any long watch.',
        },
        { type: 'ending', endingId: 'ending-become' },
        { type: 'triggerBeat', beatId: 'a3-afterglow', delayMs: 9000 },
      ],
    },
    {
      id: 'a3-afterglow',
      act: 3,
      title: 'Afterglow',
      location: 'heart-of-the-veil',
      trigger: { type: 'manual' },
      text:
        'However the weave fell, this much is true everywhere at once: the lanterns of the Skyharbor burn steady; the chord of Caelis carries; the Archive keeps; the Wood, for the first time in ten years, is planting instead of searching; and over the Mirrormere the sky admires itself, openly, like nobody is watching. Serai’s light finds each of your faces one last time, the way it did when you fell upward out of your ordinary lives. And far above, a bronze bell with no clapper rings once — clear, and glad, and true. You will know that sound again. Some mornings, just before you are fully awake, you will hear it still.',
      effects: [
        { type: 'relationship', npcId: 'serai', delta: 1 },
      ],
    },
  ],

  // ═══════════════════════════════════════════════════════════════════════
  // Random events — ambient wonder, rolled by the StoryDirector
  // ═══════════════════════════════════════════════════════════════════════
  randomEvents: [
    {
      id: 'ev-spirit-shoal',
      title: 'A Shoal of Spirits',
      text:
        'A shoal of small bright spirits drifts through, schooling like fish in air. They detour, briefly, to circle each of you once — counting, or greeting, or both — then stream away on business of their own.',
      durationMs: 20000,
      weight: 3,
      fx: 'motes',
    },
    {
      id: 'ev-memory-rain',
      title: 'Memory-Rain',
      text:
        'It begins to rain, gently, out of a clear sky — and each drop is a half-second of somewhere else: a kitchen, a train window, a hand on a doorframe. The rain is warm. Nobody else’s memories ever fit you so well.',
      durationMs: 25000,
      weight: 3,
      fx: 'sparkfall',
    },
    {
      id: 'ev-hush-surge',
      title: 'The Quiet Leans In',
      text:
        '( the quiet leans in. colors hold their breath. somewhere, a song you were humming stops being hummable. ) It passes — slowly, reluctantly, the way a wave decides against the shore. The lanterns burn a little brighter afterward, out of spite.',
      durationMs: 25000,
      weight: 2,
      mood: 'tension',
      fx: 'hush',
      minAct: 2,
    },
    {
      id: 'ev-aurora-bloom',
      title: 'Aurora Bloom',
      text:
        'The sky blooms — ribbons of teal and violet unfurling overhead like the Veil showing off. For a minute the whole world is lit in colors that feel specifically pleased to see you.',
      durationMs: 30000,
      weight: 3,
      fx: 'aurora',
    },
    {
      id: 'ev-bell-tolls',
      title: 'The Bell, Unrung',
      text:
        'Across the harbor, the clapperless bell rings once — round, bronze, and sourceless. It rings on true things, the rim says. Somewhere, just now, something true must have happened. Possibly it was you.',
      locations: ['skyharbor'],
      durationMs: 15000,
      weight: 2,
      fx: 'none',
    },
    {
      id: 'ev-riddle-merchant',
      title: 'The Merchant of Riddles',
      text:
        'A whisper at your ear, warm and amused, with the cadence of a market stall: “Lovely day for it. I buy answers, I sell questions, finest stock in the Veil. Free sample: what gets larger the more you give it away?” The whisper waits exactly long enough, then chuckles. “Keep it. You’re carrying one already.”',
      durationMs: 20000,
      weight: 2,
      fx: 'none',
    },
    {
      id: 'ev-lantern-wisps',
      title: 'Lantern-Wisps',
      text:
        'A procession of wisps comes by at knee height, each carrying a mote of lantern-light with tremendous ceremony. They are taking it somewhere dark, one of them explains, without speaking, without stopping. It is apparently a very great honor.',
      locations: ['skyharbor', 'wandering-wood'],
      durationMs: 20000,
      weight: 2,
      fx: 'motes',
    },
    {
      id: 'ev-crystal-chime',
      title: 'The City Practices',
      text:
        'Without warning, every spire in earshot rings the same soft chord — holds it — lets it fade. The city is practicing, you realize. Relearning itself, one interval at a time, like a singer warming up after a long illness.',
      locations: ['caelis'],
      durationMs: 18000,
      weight: 2,
      fx: 'sparkfall',
    },
    {
      id: 'ev-drowned-choir',
      title: 'The Drowned Choir',
      text:
        'From far below the lowest shelf comes singing — many voices, fathoms down, unhurried. Not a warning. Not a haunting. The Archive’s oldest memories sing to keep each other company, and tonight the current carries it up to you.',
      locations: ['sunken-archive'],
      durationMs: 25000,
      weight: 2,
      fx: 'none',
    },
    {
      id: 'ev-petal-tide',
      title: 'Petal-Tide',
      text:
        'The wood exhales and a tide of petals comes through, pink-gold and unreasonable, fetching up in your hair and your hood and your held-open hands. The trees watch you shake yourselves off. If trees could grin.',
      locations: ['wandering-wood'],
      durationMs: 20000,
      weight: 2,
      fx: 'sparkfall',
    },
    {
      id: 'ev-second-reflection',
      title: 'A Half-Beat Late',
      text:
        'For a moment, your reflection moves a half-beat behind you — then catches up, smooths its hair, and mouths something across the water. It looks like “thank you.” It is gone before you can ask for what.',
      locations: ['mirrormere'],
      durationMs: 15000,
      weight: 1,
      fx: 'none',
      minAct: 2,
    },
    {
      id: 'ev-star-fall',
      title: 'A Star Steps Down',
      text:
        'One star detaches from the sky with evident care, descends, and lands somewhere beyond the horizon — softly, the way a cat gets down from a wall. The other stars close ranks over the gap. None of them will discuss it.',
      durationMs: 20000,
      weight: 2,
      fx: 'sparkfall',
    },
    {
      id: 'ev-hush-watcher',
      title: 'The Still Figure',
      text:
        '( at the edge of sight: a figure of held breath, watching. it does not approach. it never approaches. it is counting you, the way the lonely count windows lit across a valley. ) When you look directly, there is only quiet, and the faint feeling of having been memorized.',
      durationMs: 20000,
      weight: 1,
      mood: 'tension',
      fx: 'hush',
      minAct: 2,
    },
    {
      id: 'ev-dreamer-sigh',
      title: 'The Dreamer Sighs',
      text:
        'The whole sky inhales — clouds drawing back, lights leaning in — and releases: a sigh from the very bottom of the world, warm as a kitchen in winter. The dream settles around you afterward like a blanket pulled up. They know you are coming. They are trying to be brave about hoping.',
      durationMs: 25000,
      weight: 2,
      fx: 'aurora',
      minAct: 3,
    },
  ],

  // ═══════════════════════════════════════════════════════════════════════
  // Endings — the last thing the table reads aloud
  // ═══════════════════════════════════════════════════════════════════════
  endings: {
    'ending-wake': {
      id: 'ending-wake',
      title: 'The Waking Shore',
      text:
        'The Veil folds itself like a letter someone intends to keep — harbor into city into forest into lake, each world gathered gently in, every lantern carried out last, still lit. There is no tearing, anywhere. There is dawn the way dawn was originally meant: total, patient, kind. The Dreamer stands up out of an age of sleep, on a shore that is suddenly, simply, morning — and the first thing they do with their waking eyes is find each of you, and the second thing they do is laugh, and the laugh is exactly the sound the Hush kept safe all those years. Then your own ceilings are above you, and your own mornings around you, and on every one of your lips: sky-salt, and the absolute certainty that none of it is gone. Real things end. That is how you know they were real.',
      epilogue: [
        {
          when: { all: ['all-echoes'] },
          text:
            'Because all three Echoes sang in the last chord, nothing — nothing — is lost in the folding. Every song of Caelis, every shelved memory, every ring of the Heartwood crosses whole into the waking world’s keeping. Serai, Aurel, Thessaly and Rowan stand together on the last shore as it becomes the first morning, and they are not folded away. They are released — into every lamplighter, librarian, builder and gardener who will ever love their work. You will recognize them constantly.',
        },
        {
          when: { none: ['all-echoes'] },
          text:
            'One Echo’s song was still missing from the final chord, and the morning knows it: beautiful, and a little thin in places, like a translation missing one word. Some days you almost remember what it was. It is not grief, quite. It is room — left in the pattern, the way the Loom always left room — for whatever you find to put there.',
        },
        {
          when: { all: ['choice:oath:remember'] },
          text:
            'You swore to the Loom that you would remember. You do. All of you, all of it, for the rest of your lives — the chord, the shelves, the petals, the bell. Friends notice that none of you ever say “it was just a dream.” You say “it was a dream,” the way other people say “it was home.”',
        },
        {
          when: { all: ['choice:oath:shelter'] },
          text:
            'You swore to the Loom that you would shelter, and the oath followed you out of the dream. Each of you wakes into a life where the small and sleeping are somehow always finding you — strays, children, friends at 3 a.m. — as if word got around. It did. You keep the watch-fires now. They never again go out.',
        },
        {
          when: { all: ['choice:oath:mend'] },
          text:
            'You swore to the Loom that you would mend, and waking does not release you. Broken things gravitate to your hands now — chairs, clocks, conversations, people — and leave them better. It is the Dreamer’s last weave, threaded through all of you: a world that lost its dream, slowly being left better than you found it.',
        },
        {
          when: {
            any: [
              'gift-lumen',
              'gift-warden',
              'gift-chronicler',
              'gift-songweaver',
              'gift-tidecaller',
              'gift-thornwalker',
              'gift-embersmith',
              'gift-veilseer',
            ],
          },
          text:
            'And the gifts came with you. A key, a page, a pearl, a charm of living briar — small impossible things that should not have survived waking, sitting on nightstands across the world in the morning light. Proof. The Veil knew its people, and the Veil keeps its receipts.',
        },
      ],
    },
    'ending-mend': {
      id: 'ending-mend',
      title: 'The Mended Veil',
      text:
        'The dream does not end. The dream is repaired — and repaired honestly, grief woven through every row where all can see it, the dark thread load-bearing at last. The Hush comes apart with a sound like a held breath finally released and falls, soft and endless, as rain over the Mirrormere: every tear refused for an age, cried at last, kept by the kind water. The dark star at the Dreamer’s chest spins itself into a hearth, and the Dreamer settles around its warmth instead of its weight. They do not wake. They no longer need to: the dream is worth dreaming again. The Veil holds. The Veil, at last, is held. And the roads stay open — every road, including yours. You wake gently, when you wake at all. The way back is exactly where you left it: just past falling asleep, first light on the left.',
      epilogue: [
        {
          when: { all: ['all-echoes'] },
          text:
            'With all three Echoes restored, the mend is seamless — better than seamless: stronger along every old break, the way gold-mended pottery is. Serai relights nothing, because nothing goes out anymore. Aurel builds, slowly now, for the joy of it. Thessaly catalogues the new rain. Rowan plants. The Veil’s long age of losing is over, and its age of tending has begun.',
        },
        {
          when: { none: ['all-echoes'] },
          text:
            'One thread still hangs loose in the mended weave — one Echo still waiting, one song still out. The dream keeps a lamp lit for whoever goes to find it, and the Loom, as ever, leaves room in the pattern. Some of you already know, in the way of dreams, that it will be you.',
        },
        {
          when: { all: ['choice:oath:remember'] },
          text:
            'The oath you swore — we will remember — is woven into the mend itself. Nothing in the Veil is ever again filed and forgotten; the Archive grows a new wing for things actively, currently loved. Thessaly calls it the Living Stacks. She pretends the name was her idea, and Rowan lets her.',
        },
        {
          when: { all: ['choice:oath:shelter'] },
          text:
            'The oath you swore — we will shelter — stands now at every threshold of the dream. Sleepers who arrive frightened find lanterns already lit, wards already warm, a forest that walks between them and the dark. The Veil has become what you promised it: a place no one is alone in.',
        },
        {
          when: { all: ['choice:oath:mend'] },
          text:
            'You swore to mend, and then you mended the whole sky. The Loom has woven your oath into its selvage — the first words of the dream’s new pattern, repeated at the edge of every row, where the Dreamer can read them whenever the old quiet whispers: leave it better. Even the grief. Especially the grief.',
        },
        {
          when: {
            any: ['choice:hush-shard:cleanse', 'choice:heartwood:nurture', 'choice:memory-pool:seal'],
          },
          text:
            'And everywhere you chose the slow kindness — the long song, the nurtured limb, the page left sovereign and unread — the mend shines brightest. Menders study those rows for ages after, trying to name the technique. There is no technique. You just have to mean it.',
        },
      ],
    },
    'ending-become': {
      id: 'ending-become',
      title: 'The New Keepers',
      text:
        'The Veil settles onto your shoulders — and it is lighter than any of you expected, because no one carries it alone, because that was always the whole secret. The Dreamer curls into their own dream like a child carried indoors at the end of a very long day, and sleeps, truly rests, for the first time since the first morning: safe inside the thing they made, watched over at last. And the party — you, all of you, the whole improbable crew of you — become what holds the sky up. You still wake for work on Mondays. You still burn toast and miss trains and forget birthdays. But part of each of you is always here now, hand on the thread, keeping the long watch in shifts the way friends keep anything: imperfectly, stubbornly, together. The lanterns know you. The roads rearrange to greet you. Somewhere below, the Dreamer dreams of being grateful, and the whole Veil fruits out of season.',
      epilogue: [
        {
          when: { all: ['all-echoes'] },
          text:
            'You do not keep the watch alone: all three Echoes restored stand it with you. Serai teaches you the lanterns; Aurel, the load-bearing chords; Thessaly, what to keep and how to bear keeping it; Rowan, when to prune and when to simply stand with a thing while it heals. Keepers and Echoes, one circle. The Hush finds no gap in it, ever again.',
        },
        {
          when: { none: ['all-echoes'] },
          text:
            'One Echo still waits out there in the unrestored quiet — and now their rescue is not an errand but an heirloom. First duty of the new keepers, written at the top of the watch-list in all your hands: bring the last one home. The dream lends you its best roads for the search.',
        },
        {
          when: { all: ['choice:oath:remember'] },
          text:
            'We will remember, you swore, back when the Loom was small and the night was large. Now remembering is your office. The keepers’ first decree, such as it was, ratified around a fire at the Skyharbor: nothing loved in this dream is ever again filed under lost. The bell rang on it, twice — once for true, once, you are fairly sure, for emphasis.',
        },
        {
          when: { all: ['choice:oath:shelter'] },
          text:
            'We will shelter, you swore — and now every frightened sleeper who falls upward into the Veil is met the way you were met: lanterns lit, faces memorized, a voice saying good, you came. You have become Serai’s welcome, multiplied. She says it is the only succession she ever wanted.',
        },
        {
          when: { all: ['choice:oath:mend'] },
          text:
            'We will mend, you swore, and keepers keep their oaths: the Veil under your watch is never finished, only ever being left better. New districts of Caelis sung up note by note. New shelves. New saplings from the Heartwood seed. The dream had a maker, then a crisis, and now — at last — it has maintainers.',
        },
        {
          when: { any: ['choice:memory-pool:read', 'choice:still-pool:gaze'] },
          text:
            'You took up the thread with clear eyes. You had seen the first memory, or seen yourselves the way the Dreamer sees you — and so you knew exactly what you were inheriting: not a burden. Company. Let there be somewhere, the first words ran, so the dark can have someone in it. There is. It does. It has all of you.',
        },
      ],
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Lore tips — single-line whispers for loading screens
  // ═══════════════════════════════════════════════════════════════════════
  loreTips: [
    'Lanterns in the Veil are not lit. They are reminded.',
    'The Hush is not silence. It is a held breath.',
    'Every door in the dream opens both ways. Most people only ever push.',
    'Serai has never once let a lantern go out. Do not ask what it cost; she will only turn up the wick.',
    'The harbor bell has no clapper. It rings anyway — on true things.',
    'Caelis was sung, not built. Its ruins are rests, not endings.',
    'The Archive keeps what you lose on waking. Yes — that dream too.',
    'The Wandering Wood is not lost. It is looking.',
    'If your reflection waves first at the Mirrormere, wave back. It remembers rudeness.',
    'The Dreamer is not trapped in the dream. The dream is how they hold us.',
    'Veilwalkers fall asleep ordinary and arrive needed.',
    'Grief that is never sung goes somewhere. The Veil knows where.',
    'An oath sworn at the Loom outlives the loom, the swearing, and sometimes the dark.',
    'Stand together at the glyphs. Light remembers light, but it counts hands.',
    'The dream likes to be raced. Hold Shift.',
  ],
};

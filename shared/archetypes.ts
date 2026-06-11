/**
 * shared/archetypes.ts
 * The eight Veilwalker archetypes players choose from. Archetypes are mostly
 * narrative flavor plus one light mechanic: some interactables are attuned to
 * a single archetype (`requiresArchetype`) and can only be sensed and used by
 * that player — giving every member of a large party a private moment.
 */

export const ARCHETYPE_IDS = [
  'lumen',
  'warden',
  'chronicler',
  'songweaver',
  'tidecaller',
  'thornwalker',
  'embersmith',
  'veilseer',
] as const;

export type ArchetypeId = (typeof ARCHETYPE_IDS)[number];

export interface ArchetypeDef {
  id: ArchetypeId;
  name: string;
  title: string;
  /** Avatar / UI accent color as 0xRRGGBB. */
  color: number;
  /** Same color as a CSS hex string, for DOM UI. */
  colorCss: string;
  /** Short backstory hook shown on the character sheet. */
  description: string;
  /** What their attunement lets them find in the world. */
  ability: string;
}

export const ARCHETYPES: Record<ArchetypeId, ArchetypeDef> = {
  lumen: {
    id: 'lumen',
    name: 'Lumenkeeper',
    title: 'Bearer of the First Light',
    color: 0xffd27a,
    colorCss: '#ffd27a',
    description:
      'You tended the lighthouse at the edge of waking, and a spark of it followed you into the dream. Where you walk, the dark thins.',
    ability: 'Senses caches of gathered light hidden from all other eyes.',
  },
  warden: {
    id: 'warden',
    name: 'Dreamwarden',
    title: 'Shield of the Sleeping',
    color: 0x6fe08a,
    colorCss: '#6fe08a',
    description:
      'Sworn to stand between sleepers and the things that circle them. You came to the Veil the night the watch-fires went out.',
    ability: 'Senses old wards and guardian-stones that answer only to a warden.',
  },
  chronicler: {
    id: 'chronicler',
    name: 'Chronicler',
    title: 'Keeper of Unwritten Pages',
    color: 0x7ab8ff,
    colorCss: '#7ab8ff',
    description:
      'You collect the stories people forget on waking. Your satchel of blank books grows heavier every year — something is writing back.',
    ability: 'Can read the old dream-script that appears as blur to everyone else.',
  },
  songweaver: {
    id: 'songweaver',
    name: 'Songweaver',
    title: 'Voice of the Resonance',
    color: 0xc89bff,
    colorCss: '#c89bff',
    description:
      'Every place has a chord that holds it together. You heard the Veil go out of tune from your bed, three worlds away.',
    ability: 'Hears resonances and silent instruments no one else can attune.',
  },
  tidecaller: {
    id: 'tidecaller',
    name: 'Tidecaller',
    title: 'Listener Beneath the Waves',
    color: 0x4be3c3,
    colorCss: '#4be3c3',
    description:
      'The sea kept your secrets and you kept its. When the drowned places of the dream began to wake, they called you by name.',
    ability: 'Senses what the deep water has swallowed and kept safe.',
  },
  thornwalker: {
    id: 'thornwalker',
    name: 'Thornwalker',
    title: 'Friend of the Moving Forest',
    color: 0x9fe060,
    colorCss: '#9fe060',
    description:
      'You once spared a wood that meant you harm, and it has owed you a debt of paths ever since. Branches part for you here.',
    ability: 'Finds the green doors and grown-over paths the forest hides.',
  },
  embersmith: {
    id: 'embersmith',
    name: 'Embersmith',
    title: 'Tender of the Last Forge',
    color: 0xff9d5c,
    colorCss: '#ff9d5c',
    description:
      'Your family forged tools for dreamers: keys, lanterns, compasses that point at longing. The forge went cold. You want to know why.',
    ability: 'Senses cold forges and unfinished works that ask for a maker\'s hand.',
  },
  veilseer: {
    id: 'veilseer',
    name: 'Veilseer',
    title: 'Eyes Open in Both Worlds',
    color: 0x8d7bff,
    colorCss: '#8d7bff',
    description:
      'You were born seeing the seams of the dream. The Hush is not invisible to you — and lately, it has begun looking back.',
    ability: 'Sees through the Hush to the still, true things hidden inside it.',
  },
};

export function isArchetypeId(value: unknown): value is ArchetypeId {
  return typeof value === 'string' && (ARCHETYPE_IDS as readonly string[]).includes(value);
}

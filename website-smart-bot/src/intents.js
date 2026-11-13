import { normalise } from './text.js';

// Deterministic understanding of clearly structured messages. A match here costs no Gemini request.
// route() is pure: it only inspects the text and the already-loaded room list.

const SPACE_WORDS = [
  [/laborator(?:y|ies)|\blabs?\b/, 'laboratory'],
  [/meeting rooms?/, 'meeting'],
  [/offices?/, 'office'],
  [/washrooms?|toilets?/, 'washroom'],
  [/corridors?/, 'corridor'],
  [/classrooms?|\brooms?\b|spaces?/, 'classroom'],
];
const COUNT_NOUN = '(?:meeting rooms?|laborator(?:y|ies)|labs?|classrooms?|offices?|washrooms?|corridors?|rooms?|spaces?)';
const CATEGORY_WORDS = [
  [/\b(?:lights?|lamps?|lighting|tube ?lights?|led)\b/, 'lighting'],
  [/\b(?:fans?)\b/, 'fan'],
  [/\b(?:sockets?|plugs?|outlets?)\b/, 'socket'],
  [/\b(?:acs?|a\/c|air[- ]?conditioners?|split acs?)\b/, 'ac'],
];

export const spaceTypeIn = (text) => SPACE_WORDS.find(([re]) => re.test(text))?.[1];
export const categoryIn = (text) => CATEGORY_WORDS.find(([re]) => re.test(text))?.[1];

// Pass only the part of the sentence before the message body, so words inside the announcement
// itself ("students must leave") can never change who it is sent to.
export function audienceIn(text) {
  if (/\b(?:viewers?|students?|visitors?)\b/.test(text)) return 'viewers';
  if (/\b(?:staff|teachers?|faculty|admins?|administrators?|technicians?)\b/.test(text)) return 'staff';
  if (/\b(?:everyone|everybody|all users|all accounts|all people|all)\b/.test(text)) return 'all';
  return null;
}

export function findRoom(text, rooms) {
  const t = text.toLowerCase();
  let best = null;
  for (const room of rooms) {
    const code = String(room.code ?? '').toLowerCase();
    const name = String(room.name ?? '').toLowerCase();
    const codeHit = code && new RegExp(`(?<![a-z0-9-])${escapeRe(code)}(?![a-z0-9-])`).test(t);
    const nameHit = name && t.includes(name);
    const score = (codeHit ? 100 : 0) + (nameHit ? 50 : 0) + (codeHit || nameHit ? code.length + name.length : 0);
    if (score && (!best || score > best.score)) best = { room, score };
  }
  return best?.room ?? null;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A token that looks like a room code (starts with a letter, contains a digit: R105, HIDDEN-1, B1-009)
// but matches none of the rooms in scope. Floor names and quantities like "10am" are not room codes.
function strayCode(text, rooms) {
  const known = new Set(rooms.map((r) => String(r.code).toLowerCase()));
  const scrubbed = text.replace(/\bfloors?\s+[a-z0-9_-]+/g, ' ');
  for (const token of scrubbed.match(/\b[a-z][a-z0-9]*(?:-[a-z0-9]+)*\b/g) ?? []) {
    if (/\d/.test(token) && token.length >= 2 && !known.has(token)) return token;
  }
  return null;
}

const floorCodeIn = (text) => {
  const m = text.match(/\bfloor\s+(?:named\s+|called\s+|number\s+|no\.?\s*)?["']?([a-z0-9][a-z0-9_-]*)["']?/i);
  const code = m?.[1];
  // "floor with 4 rooms" must not read "with" as a floor name.
  return code && !/^(?:with|having|containing|that|and|has|of|in|on|to|for|plan|names?)$/i.test(code) ? code.toUpperCase() : null;
};

const COMPLEX = /\b(?:best|suit(?:able|s)?|recommend\w*|should|why|because|compare|comparison|most|least|largest|smallest|biggest|better|worse|explain|enough|fit|fits|ideal|prefer\w*|summar\w+|difference|between)\b/;

const dayIn = (text) => (/\btomorrow\b/.test(text) ? 1 : /\byesterday\b/.test(text) ? -1 : 0);

// Returns { kind, params } or { kind:'ask', ... } for a missing detail, or null when only Gemini can help.
export function route(rawMessage, { role, rooms = [], conv = {} } = {}) {
  const text = normalise(rawMessage);
  if (!text) return { kind: 'empty' };
  const isAdmin = role === 'admin';
  const room = findRoom(text, rooms);
  const floor = floorCodeIn(rawMessage);

  if (/^(?:hi|hello|hey|good (?:morning|afternoon|evening)|thanks|thank you|ok|okay)$/.test(text)) return { kind: 'greeting', params: { thanks: /thank/.test(text) } };
  if (/^(?:help|what can you do|what can i ask|commands?|examples?)$/.test(text) || /\bwhat can (?:you|i)\b/.test(text)) return { kind: 'help' };
  if (/^(?:cancel|never ?mind|stop|forget it|no|nope|don'?t)$/.test(text)) return { kind: 'cancel_pending' };
  if (/^(?:yes|yep|yeah|confirm|confirmed|go ahead|do it|apply|apply it|proceed)$/.test(text)) return { kind: 'confirm_pending' };

  // ---- administrator commands (recognised for everyone so non-admins get a clear refusal) ----
  const wantsWrite = /\b(?:create|add|make|new|book|reserve|schedule|cancel|send|post|publish|broadcast|announce|remove|delete|update|change|rename|set)\b/;
  if (wantsWrite.test(text)) {
    const announce = text.match(/\b(?:send|post|publish|broadcast|create|make|announce)\b.*\b(?:alert|announcement|notification|notice|message)\b/);
    if (announce || /^announce\b/.test(text)) {
      const split = rawMessage.match(/(?:\bthat\b|\bsaying\b|\bstating\b|\bwith (?:the )?(?:message|text)\b|:)\s*(.+)$/is);
      const head = split ? rawMessage.slice(0, split.index) : rawMessage;
      return { kind: 'send_announcement', params: { audience: audienceIn(normalise(head)), message: split?.[1]?.trim() || null } };
    }

    const bookCancel = text.match(/\bcancel\b.*\b(?:booking|class|lecture|session|reservation)\b/);
    if (bookCancel) {
      // With a room and a time named, working out which booking is meant is a job for Gemini.
      // Without them, ask for the missing detail rather than spend a request on a guess.
      const when = /\b(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening|\d{1,2}(?::\d{2})?\s*(?:am|pm)|at \d{1,2})\b/.test(text);
      return room && when ? { kind: 'needs_ai', params: { reason: 'cancel_booking' } } : { kind: 'unsupported_write', params: { reason: 'cancel_booking' } };
    }

    if (/\b(?:create|add|make|new)\b/.test(text) && /\bfloor\b/.test(text) && !/\b(?:to|on|in)\s+floor\b/.test(text)) {
      const count = text.match(new RegExp(`(\\d+)\\s*(?:${COUNT_NOUN})`))?.[1];
      const cap = text.match(/\bcapacity\s*(?:of\s*)?(\d+)|(\d+)\s*(?:seats?|people|students)\b/);
      return {
        kind: 'create_floor',
        params: {
          floorCode: floor,
          roomCount: count ? Number(count) : 0,
          spaceType: spaceTypeIn(text.replace(/\bfloor\b/g, '')) ?? 'classroom',
          capacity: cap ? Number(cap[1] ?? cap[2]) : 0,
        },
      };
    }

    const addRooms = text.match(new RegExp(`\\badd\\s+(\\d+)\\s*(${COUNT_NOUN})\\b.*\\b(?:to|on|in)\\s+floor\\b`));
    if (addRooms) {
      return { kind: 'add_rooms', params: { floorCode: floor, count: Number(addRooms[1]), spaceType: spaceTypeIn(addRooms[2]) ?? 'classroom', capacity: Number(text.match(/capacity\s*(?:of\s*)?(\d+)/)?.[1] ?? 0) } };
    }

    const addDevices = text.match(/\badd\s+(\d+)\s+(.+?)\s+(?:to|in|into)\s+(?:the\s+)?(?:room\s+)?(.+)$/);
    if (addDevices) {
      const targetRoom = findRoom(addDevices[3], rooms) ?? findRoom(text, rooms);
      const category = categoryIn(addDevices[2]) ?? 'other';
      const watts = text.match(/(\d+(?:\.\d+)?)\s*(?:w|watts?)\b/)?.[1];
      return { kind: 'add_devices', params: { roomCode: targetRoom?.code ?? addDevices[3].split(/\s+/)[0].toUpperCase(), roomKnown: Boolean(targetRoom), category, count: Number(addDevices[1]), ratedWatts: watts ? Number(watts) : null, name: null } };
    }

    if (/\b(?:book|reserve)\b/.test(text)) return { kind: 'needs_ai', params: { reason: 'booking' } };
    if (/\b(?:update|change|rename|remove|delete|set)\b/.test(text)) return { kind: 'unsupported_write', params: { reason: 'update' } };
  }

  // ---- follow-ups that reuse the previous question ----
  const follow = text.match(/^(?:and|what about|how about|also|then)\s+(.+)$/);
  if (follow && conv.last?.kind) {
    const inner = follow[1];
    const params = { ...conv.last.params };
    const r = findRoom(inner, rooms);
    if (r) params.roomId = r._id;
    const f = floorCodeIn(`floor ${inner.replace(/^(?:on|in)\s+/, '').replace(/^floor\s+/, '')}`);
    if (/\bfloor\b/.test(inner) && f) params.floorCode = f;
    if (/\b(?:today|tomorrow|yesterday)\b/.test(inner)) params.dayOffset = dayIn(inner);
    return { kind: conv.last.kind, params, followUp: true };
  }

  // Open-ended questions need reasoning over the data, which is what Gemini is for.
  if (COMPLEX.test(text)) return null;

  // ---- read questions ----
  const mentionsRoom = Boolean(room) || (/\b(?:its|that room|this room|there)\b/.test(text) && conv.lastRoomId);
  const roomId = room?._id ?? (mentionsRoom ? conv.lastRoomId : undefined);

  // A specific room was asked about but is not one the person can see (or does not exist). Say so,
  // rather than quietly answering about every room they can see.
  const stray = mentionsRoom ? null : strayCode(text, rooms);
  if (stray && /\b(?:devices?|equipment|loads?|appliances?|fans?|lights?|sockets?|schedule|timetable|bookings?|classes|lectures?|where|status|details|info|information)\b/.test(text)) {
    return { kind: 'unknown_place', params: { query: stray.toUpperCase() } };
  }

  if (/\bhow many floors?\b/.test(text) || /\bnumber of floors\b/.test(text)) return { kind: 'count_floors' };
  if (/\b(?:list|show|display|what|which)\b.*\bfloors\b/.test(text) && !/\b(?:on|in)\s+floors?\b/.test(text) && !room) return { kind: 'list_floors' };

  if (/\bhow many\b.*\b(?:devices?|equipment|loads?|appliances?|fans?|lights?|lamps?|sockets?|acs?|air conditioners?)\b/.test(text) || /\bnumber of (?:devices|equipment|loads|fans|lights)\b/.test(text)) {
    return { kind: 'count_devices', params: { category: categoryIn(text), roomId } };
  }
  if (/\b(?:what|which|list|show)\b.*\b(?:devices?|equipment|loads?|appliances?|fans|lights|sockets|acs?)\b/.test(text)) return { kind: 'list_devices', params: { category: categoryIn(text), roomId } };

  if (/\b(?:announcements?|notices?|alerts?|news)\b/.test(text) || /\bany(?:thing)? new\b/.test(text)) {
    return { kind: 'announcements', params: { onlyNew: /\bnew\b|\bunread\b|\blatest\b|\bany\b/.test(text) } };
  }

  if (/\b(?:schedule|timetable|bookings?|classes|lectures?|sessions?|agenda|what(?:'s| is) on)\b/.test(text)) {
    return { kind: 'schedule', params: { roomId, dayOffset: dayIn(text) } };
  }

  if (/\bhow many\b.*\b(?:rooms?|spaces?|classrooms?|labs?|laborator(?:y|ies)|offices?|meeting rooms?)\b/.test(text) || /\bnumber of (?:rooms|spaces)\b/.test(text)) {
    return { kind: 'count_rooms', params: { floorCode: /\bfloor\b/.test(text) ? floor : null, spaceType: spaceTypeIn(text) === 'classroom' && !/classrooms?/.test(text) ? null : spaceTypeIn(text) } };
  }
  if (/\b(?:list|show|display|what|which|all|available)\b.*\b(?:rooms?|spaces?|classrooms?|labs?|laborator(?:y|ies)|offices?)\b/.test(text) && !room) {
    return { kind: 'list_rooms', params: { floorCode: /\bfloor\b/.test(text) ? floor : null, spaceType: spaceTypeIn(text) === 'classroom' && !/classrooms?/.test(text) ? null : spaceTypeIn(text) } };
  }
  if (/\b(?:where|find|locate|located|which floor|tell me about|details|info|information|status)\b/.test(text) || (room && text.split(' ').length <= 3)) {
    if (room || mentionsRoom) return { kind: 'room_info', params: { roomId } };
    if (/^where\b/.test(text)) return { kind: 'unknown_place', params: { query: text.replace(/^where (?:is|are|can i find)\s+(?:the\s+)?/, '') } };
  }

  return null;
}

// A lone number answers "what rated power?"; any text answers "what should the message say?".
export function fillPending(pending, rawMessage) {
  const text = rawMessage.trim();
  if (pending.ask === 'ratedWatts') {
    const n = text.match(/^(\d+(?:\.\d+)?)\s*(?:w|watts?)?$/i)?.[1];
    return n ? { ...pending.params, ratedWatts: Number(n) } : null;
  }
  if (pending.ask === 'message') return text.length >= 3 ? { ...pending.params, message: text } : null;
  if (pending.ask === 'audience') {
    const a = audienceIn(normalise(text));
    return a ? { ...pending.params, audience: a } : null;
  }
  if (pending.ask === 'floorCode') {
    const m = text.match(/^(?:floor\s+)?([a-z0-9][\w-]*)$/i)?.[1];
    return m ? { ...pending.params, floorCode: m.toUpperCase() } : null;
  }
  return null;
}

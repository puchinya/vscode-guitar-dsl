/** A written measure reduced to the structural values used by play-order resolution. */
export interface PlayOrderMeasure {
  measureIndex: number;
  repeatStart: boolean;
  repeatEnd: boolean;
  bracket?: string;
  specialMark?: string;
  sectionName?: string;
}

export interface PlayOrderOccurrence {
  /** Contiguous zero-based execution index. */
  occurrenceIndex: number;
  /** Written-score MeasureData.measureIndex. */
  measureIndex: number;
}

export type PlayOrderDiagnosticCode =
  | 'playOrderMultipleNavigationJumps'
  | 'playOrderMissingDestination'
  | 'playOrderAmbiguousDestination'
  | 'playOrderInvalidVolta'
  | 'playOrderVoltaWithoutRepeat'
  | 'playOrderUnclosedRepeat'
  | 'playOrderCycle'
  | 'playOrderLimitExceeded';

export interface PlayOrderDiagnostic {
  code: PlayOrderDiagnosticCode;
  severity: 'error';
  measureIndex: number;
  args?: Record<string, string | number>;
}

export interface PlayOrderResult {
  valid: boolean;
  occurrences: PlayOrderOccurrence[];
  diagnostics: PlayOrderDiagnostic[];
}

export const MAX_PLAY_ORDER_OCCURRENCES = 100_000;

type VoltaRange = readonly [first: number, last: number];

interface ParsedVolta {
  ranges: VoltaRange[];
  highestPass: number;
  includes(pass: number): boolean;
}

interface RepeatBlock {
  id: number;
  start: number;
  end: number;
  maxPass: number;
  voltaPositions: number[];
  voltaCountInBody: number;
  children: RepeatBlock[];
}

interface RepeatStructure {
  blocks: RepeatBlock[];
  repeatEndBlocks: Map<number, RepeatBlock>;
  voltaOwners: Map<number, RepeatBlock>;
  voltaPasses: Map<number, ParsedVolta>;
  diagnostics: PlayOrderDiagnostic[];
}

interface PassTrieNode {
  id: number;
  left?: PassTrieNode;
  right?: PassTrieNode;
  value?: number;
}

const EMPTY_PASS_TRIE: PassTrieNode = { id: 0 };

function parseVolta(bracket: string): ParsedVolta | undefined {
  const components = bracket.split(',');
  if (components.length === 0 || components.some(component => component.length === 0)) return undefined;

  const ranges: VoltaRange[] = [];
  let highestPass = 0;
  for (const component of components) {
    const token = component.endsWith('.') ? component.slice(0, -1) : component;
    const match = token.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) return undefined;

    const first = Number(match[1]);
    const last = match[2] === undefined ? first : Number(match[2]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first <= 0 || last <= 0 || first > last) {
      return undefined;
    }

    ranges.push([first, last]);
    highestPass = Math.max(highestPass, last);
  }

  return {
    ranges,
    highestPass,
    includes: pass => ranges.some(([first, last]) => first <= pass && pass <= last)
  };
}

function diagnostic(
  measures: readonly PlayOrderMeasure[],
  position: number,
  code: PlayOrderDiagnosticCode,
  args?: Record<string, string | number>
): PlayOrderDiagnostic {
  return {
    code,
    severity: 'error',
    measureIndex: measures[position]?.measureIndex ?? 0,
    ...(args ? { args } : {})
  };
}

function sortDiagnostics(diagnostics: PlayOrderDiagnostic[]): PlayOrderDiagnostic[] {
  return diagnostics.sort((a, b) => a.measureIndex - b.measureIndex || a.code.localeCompare(b.code));
}

function buildRepeatStructure(measures: readonly PlayOrderMeasure[]): RepeatStructure {
  const blocks: RepeatBlock[] = [];
  const repeatEndBlocks = new Map<number, RepeatBlock>();
  const voltaOwners = new Map<number, RepeatBlock>();
  const diagnostics: PlayOrderDiagnostic[] = [];
  const explicitStack: RepeatBlock[] = [];
  let sharedEnding: { block: RepeatBlock; lastPosition: number } | undefined;
  let sectionStart = 0;

  for (let position = 0; position < measures.length; position += 1) {
    const measure = measures[position];
    if (measure.sectionName) {
      sectionStart = position;
      sharedEnding = undefined;
    }

    const continuesSharedEnding = Boolean(
      sharedEnding
      && sharedEnding.lastPosition === position - 1
      && measure.bracket !== undefined
      && !measure.repeatStart
      && !measure.sectionName
    );
    if (!continuesSharedEnding) sharedEnding = undefined;

    if (measure.repeatStart) {
      sharedEnding = undefined;
      const block: RepeatBlock = {
        id: blocks.length,
        start: position,
        end: -1,
        maxPass: 2,
        voltaPositions: [],
        voltaCountInBody: 0,
        children: []
      };
      blocks.push(block);
      explicitStack.push(block);
    }

    let closedBlock: RepeatBlock | undefined;
    if (measure.repeatEnd) {
      if (continuesSharedEnding && sharedEnding) {
        closedBlock = sharedEnding.block;
        repeatEndBlocks.set(position, closedBlock);
      } else if (explicitStack.length > 0) {
        closedBlock = explicitStack.pop()!;
        closedBlock.end = position;
        repeatEndBlocks.set(position, closedBlock);
      } else {
        const block: RepeatBlock = {
          id: blocks.length,
          start: sectionStart,
          end: position,
          maxPass: 2,
          voltaPositions: [],
          voltaCountInBody: 0,
          children: []
        };
        blocks.push(block);
        closedBlock = block;
        repeatEndBlocks.set(position, block);
      }
    }

    if (continuesSharedEnding && sharedEnding) {
      voltaOwners.set(position, sharedEnding.block);
      sharedEnding = { block: sharedEnding.block, lastPosition: position };
    } else if (closedBlock) {
      sharedEnding = { block: closedBlock, lastPosition: position };
    }
  }

  for (const block of explicitStack) {
    diagnostics.push(diagnostic(measures, block.start, 'playOrderUnclosedRepeat'));
  }

  const voltaPasses = new Map<number, ParsedVolta>();
  for (let position = 0; position < measures.length; position += 1) {
    const bracket = measures[position].bracket;
    if (bracket === undefined) continue;

    const parsed = parseVolta(bracket);
    if (!parsed) {
      diagnostics.push(diagnostic(measures, position, 'playOrderInvalidVolta', { bracket }));
      continue;
    }
    voltaPasses.set(position, parsed);

    const owner = voltaOwners.get(position) ?? innermostContainingBlock(blocks, position);
    if (!owner) {
      diagnostics.push(diagnostic(measures, position, 'playOrderVoltaWithoutRepeat', { bracket }));
      continue;
    }
    voltaOwners.set(position, owner);
    owner.voltaPositions.push(position);
    if (owner.start <= position && position <= owner.end) owner.voltaCountInBody += 1;
  }

  for (const block of blocks) {
    for (const position of block.voltaPositions) {
      const volta = voltaPasses.get(position);
      if (volta) block.maxPass = Math.max(block.maxPass, volta.highestPass);
    }
  }

  return { blocks, repeatEndBlocks, voltaOwners, voltaPasses, diagnostics };
}

function innermostContainingBlock(blocks: readonly RepeatBlock[], position: number): RepeatBlock | undefined {
  let innermost: RepeatBlock | undefined;
  for (const block of blocks) {
    if (block.end < 0 || block.start > position || position > block.end) continue;
    if (!innermost
      || block.start > innermost.start
      || (block.start === innermost.start && block.end < innermost.end)) {
      innermost = block;
    }
  }
  return innermost;
}

function nextPassAfter(block: RepeatBlock, currentPass: number, voltaPasses: Map<number, ParsedVolta>): number {
  let nextPass = block.maxPass;
  for (const position of block.voltaPositions) {
    for (const [first, last] of voltaPasses.get(position)?.ranges ?? []) {
      if (first > currentPass) nextPass = Math.min(nextPass, first);
      else if (last > currentPass) nextPass = Math.min(nextPass, currentPass + 1);
    }
  }
  return nextPass;
}

function hasLaterVoltaForPass(
  block: RepeatBlock,
  position: number,
  pass: number,
  voltaPasses: Map<number, ParsedVolta>
): boolean {
  return block.voltaPositions.some(voltaPosition => voltaPosition > position
    && (voltaPasses.get(voltaPosition)?.includes(pass) ?? false));
}

function buildRepeatNestingTree(blocks: readonly RepeatBlock[]): void {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end || a.id - b.id);
  const stack: RepeatBlock[] = [];
  for (const block of sorted) {
    while (stack.length > 0 && stack[stack.length - 1].end < block.end) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent && parent.start <= block.start && block.end <= parent.end
      && (parent.start < block.start || block.end < parent.end)) {
      parent.children.push(block);
    }
    stack.push(block);
  }
}

function addNavigationDiagnostics(measures: readonly PlayOrderMeasure[], diagnostics: PlayOrderDiagnostic[]): {
  primaryJump: number | undefined;
  segno: number | undefined;
  coda: number | undefined;
} {
  const primaryJumps: number[] = [];
  const segnos: number[] = [];
  const codas: number[] = [];
  const toCoda: number[] = [];

  measures.forEach((measure, position) => {
    switch (measure.specialMark) {
      case 'dc':
      case 'ds':
        primaryJumps.push(position);
        break;
      case 'segno':
        segnos.push(position);
        break;
      case 'coda':
        codas.push(position);
        break;
      case 'to_coda':
        toCoda.push(position);
        break;
    }
  });

  if (primaryJumps.length > 1) {
    for (const position of primaryJumps) {
      diagnostics.push(diagnostic(measures, position, 'playOrderMultipleNavigationJumps', { count: primaryJumps.length }));
    }
  }

  for (const position of primaryJumps) {
    if (measures[position].specialMark !== 'ds') continue;
    if (segnos.length === 0) {
      diagnostics.push(diagnostic(measures, position, 'playOrderMissingDestination', { destination: 'Segno' }));
    } else if (segnos.length > 1) {
      diagnostics.push(diagnostic(measures, position, 'playOrderAmbiguousDestination', { destination: 'Segno', count: segnos.length }));
    }
  }

  if (primaryJumps.length > 0 && toCoda.length > 0) {
    if (codas.length === 0) {
      diagnostics.push(diagnostic(measures, primaryJumps[0], 'playOrderMissingDestination', { destination: 'Coda' }));
    } else if (codas.length > 1) {
      diagnostics.push(diagnostic(measures, primaryJumps[0], 'playOrderAmbiguousDestination', { destination: 'Coda', count: codas.length }));
    }
  }

  return {
    primaryJump: primaryJumps.length === 1 ? primaryJumps[0] : undefined,
    segno: segnos.length === 1 ? segnos[0] : undefined,
    coda: codas.length === 1 ? codas[0] : undefined
  };
}

/**
 * Resolve written repeat and navigation marks into a deterministic sequence of written measure identities.
 * This function is synchronous, pure, reentrant, and independent of parsing and rendering.
 */
export function resolvePlayOrder(measures: readonly PlayOrderMeasure[]): PlayOrderResult {
  if (measures.length === 0) return { valid: true, occurrences: [], diagnostics: [] };

  const structure = buildRepeatStructure(measures);
  const navigation = addNavigationDiagnostics(measures, structure.diagnostics);
  if (structure.diagnostics.length > 0) {
    return { valid: false, occurrences: [], diagnostics: sortDiagnostics(structure.diagnostics) };
  }
  buildRepeatNestingTree(structure.blocks);

  const startsAt = new Map<number, RepeatBlock[]>();
  for (const block of structure.blocks) {
    const starts = startsAt.get(block.start) ?? [];
    starts.push(block);
    startsAt.set(block.start, starts);
  }
  const fastForwardableBlocks = new Set<number>();
  for (const outer of structure.blocks) {
    const bodyLength = outer.end - outer.start + 1;
    if (bodyLength > 0 && outer.voltaCountInBody === bodyLength) fastForwardableBlocks.add(outer.id);
  }

  const occurrences: PlayOrderOccurrence[] = [];
  const diagnostics: PlayOrderDiagnostic[] = [];
  const passes = new Map<number, number>();
  const stateInterner = new Map<string, PassTrieNode>();
  const trieDepth = Math.ceil(Math.log2(Math.max(1, structure.blocks.length)));
  let nextTrieId = 1;
  let passStateRoot = EMPTY_PASS_TRIE;

  const internLeaf = (value: number): PassTrieNode => {
    const key = `leaf:${value}`;
    let node = stateInterner.get(key);
    if (!node) {
      node = { id: nextTrieId++, value };
      stateInterner.set(key, node);
    }
    return node;
  };

  const internBranch = (level: number, left: PassTrieNode, right: PassTrieNode): PassTrieNode => {
    if (left === EMPTY_PASS_TRIE && right === EMPTY_PASS_TRIE) return EMPTY_PASS_TRIE;
    const key = `branch:${level}:${left.id}:${right.id}`;
    let node = stateInterner.get(key);
    if (!node) {
      node = { id: nextTrieId++, left, right };
      stateInterner.set(key, node);
    }
    return node;
  };

  const updatePassTrie = (node: PassTrieNode, blockId: number, value: number, level = trieDepth): PassTrieNode => {
    if (level < 0) return internLeaf(value);
    const bit = (blockId >> level) & 1;
    const left = node.left ?? EMPTY_PASS_TRIE;
    const right = node.right ?? EMPTY_PASS_TRIE;
    if (bit === 0) return internBranch(level, updatePassTrie(left, blockId, value, level - 1), right);
    return internBranch(level, left, updatePassTrie(right, blockId, value, level - 1));
  };

  const setPass = (blockId: number, pass: number) => {
    passes.set(blockId, pass);
    passStateRoot = updatePassTrie(passStateRoot, blockId, pass);
  };

  const seenStates = new Set<string>();
  let position = 0;
  let primaryJumpConsumed = false;
  let codaJumpConsumed = false;
  let postPrimaryJump = false;

  while (position < measures.length) {
    for (const block of startsAt.get(position) ?? []) {
      if (!passes.has(block.id)) setPass(block.id, 1);
    }

    const stateKey = `${position}|${postPrimaryJump ? 1 : 0}|${primaryJumpConsumed ? 1 : 0}|${codaJumpConsumed ? 1 : 0}|${passStateRoot.id}`;
    if (seenStates.has(stateKey)) {
      diagnostics.push(diagnostic(measures, position, 'playOrderCycle'));
      return { valid: false, occurrences: [], diagnostics: sortDiagnostics(diagnostics) };
    }
    seenStates.add(stateKey);

    const measure = measures[position];
    const owner = structure.voltaOwners.get(position);
    const volta = structure.voltaPasses.get(position);
    const currentPass = owner
      ? (postPrimaryJump ? owner.maxPass : (passes.get(owner.id) ?? 1))
      : 1;
    const emitted = !volta || !owner || volta.includes(currentPass);

    if (emitted) {
      if (occurrences.length >= MAX_PLAY_ORDER_OCCURRENCES) {
        diagnostics.push(diagnostic(measures, position, 'playOrderLimitExceeded', { limit: MAX_PLAY_ORDER_OCCURRENCES }));
        return { valid: false, occurrences: [], diagnostics: sortDiagnostics(diagnostics) };
      }
      occurrences.push({ occurrenceIndex: occurrences.length, measureIndex: measure.measureIndex });

      if (postPrimaryJump && measure.specialMark === 'fine') break;

      if (postPrimaryJump && !codaJumpConsumed && measure.specialMark === 'to_coda') {
        codaJumpConsumed = true;
        position = navigation.coda!;
        continue;
      }

      if (!primaryJumpConsumed && navigation.primaryJump === position) {
        primaryJumpConsumed = true;
        postPrimaryJump = true;
        position = measure.specialMark === 'dc' ? 0 : navigation.segno!;
        continue;
      }
    }

    const repeatEndBlock = structure.repeatEndBlocks.get(position);
    if (!postPrimaryJump && repeatEndBlock) {
      const pass = passes.get(repeatEndBlock.id) ?? 1;
      const skippedEndingHasLaterMatch = !emitted
        && volta !== undefined
        && owner === repeatEndBlock
        && hasLaterVoltaForPass(repeatEndBlock, position, pass, structure.voltaPasses);
      if (pass < repeatEndBlock.maxPass && !skippedEndingHasLaterMatch) {
        const nextPass = fastForwardableBlocks.has(repeatEndBlock.id)
          ? nextPassAfter(repeatEndBlock, pass, structure.voltaPasses)
          : pass + 1;
        setPass(repeatEndBlock.id, nextPass);
        const stack = [...repeatEndBlock.children];
        while (stack.length > 0) {
          const descendant = stack.pop()!;
          setPass(descendant.id, 1);
          stack.push(...descendant.children);
        }
        position = repeatEndBlock.start;
        continue;
      }
    }

    position += 1;
  }

  return { valid: true, occurrences, diagnostics: [] };
}

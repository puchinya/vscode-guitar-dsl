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
  let activeSharedEnding: { block: RepeatBlock; lastPosition: number } | undefined;
  let sectionStart = 0;

  for (let position = 0; position < measures.length; position += 1) {
    const measure = measures[position];
    if (measure.sectionName) {
      sectionStart = position;
      sharedEnding = undefined;
      activeSharedEnding = undefined;
    }

    if (measure.repeatStart) {
      sharedEnding = undefined;
      activeSharedEnding = undefined;
    }

    const startsSharedEnding = Boolean(
      sharedEnding
      && sharedEnding.lastPosition === position - 1
      && measure.bracket !== undefined
      && !measure.repeatStart
      && !measure.sectionName
    );
    if (startsSharedEnding && sharedEnding) {
      activeSharedEnding = { block: sharedEnding.block, lastPosition: position };
      sharedEnding = undefined;
    } else if (sharedEnding) {
      sharedEnding = undefined;
    }

    if (activeSharedEnding && measure.bracket !== undefined && !startsSharedEnding) {
      activeSharedEnding = undefined;
    }
    const continuesSharedEnding = activeSharedEnding !== undefined;
    if (activeSharedEnding) voltaOwners.set(position, activeSharedEnding.block);

    if (measure.repeatStart) {
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
      if (continuesSharedEnding && activeSharedEnding) {
        closedBlock = activeSharedEnding.block;
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

    if (continuesSharedEnding && activeSharedEnding) {
      if (measure.repeatEnd) {
        sharedEnding = { block: activeSharedEnding.block, lastPosition: position };
        activeSharedEnding = undefined;
      } else {
        activeSharedEnding = { block: activeSharedEnding.block, lastPosition: position };
      }
    } else if (closedBlock) {
      sharedEnding = { block: closedBlock, lastPosition: position };
    }
  }

  for (const block of explicitStack) {
    diagnostics.push(diagnostic(measures, block.start, 'playOrderUnclosedRepeat'));
  }

  const parsedVoltas = new Map<number, ParsedVolta>();
  for (let position = 0; position < measures.length; position += 1) {
    const bracket = measures[position].bracket;
    if (bracket === undefined) continue;

    const parsed = parseVolta(bracket);
    if (!parsed) {
      diagnostics.push(diagnostic(measures, position, 'playOrderInvalidVolta', { bracket }));
      continue;
    }
    parsedVoltas.set(position, parsed);
  }

  const voltaPasses = new Map<number, ParsedVolta>();
  let activeVoltaSegment: { owner: RepeatBlock | undefined; passes: ParsedVolta } | undefined;
  for (let position = 0; position < measures.length; position += 1) {
    const measure = measures[position];
    if (measure.sectionName || measure.repeatStart) activeVoltaSegment = undefined;

    if (measure.bracket !== undefined) {
      activeVoltaSegment = undefined;
      const parsed = parsedVoltas.get(position);
      if (!parsed) continue;

      const owner = voltaOwners.get(position) ?? innermostContainingBlock(blocks, position);
      if (!owner) {
        diagnostics.push(diagnostic(measures, position, 'playOrderVoltaWithoutRepeat', { bracket: measure.bracket }));
      } else {
        voltaOwners.set(position, owner);
        owner.voltaPositions.push(position);
      }
      activeVoltaSegment = { owner, passes: parsed };
    }

    if (activeVoltaSegment) {
      voltaPasses.set(position, activeVoltaSegment.passes);
      if (activeVoltaSegment.owner) {
        const owner = activeVoltaSegment.owner;
        voltaOwners.set(position, owner);
        if (owner.start <= position && position <= owner.end) owner.voltaCountInBody += 1;
      }
      if (measure.repeatEnd) activeVoltaSegment = undefined;
    }
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
  const setPass = (blockId: number, pass: number) => {
    passes.set(blockId, pass);
  };

  let position = 0;
  let primaryJumpConsumed = false;
  let codaJumpConsumed = false;
  let postPrimaryJump = false;

  while (position < measures.length) {
    for (const block of startsAt.get(position) ?? []) {
      if (!passes.has(block.id)) setPass(block.id, 1);
    }

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

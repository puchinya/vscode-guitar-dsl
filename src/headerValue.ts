export interface HeaderValueParts {
  source: string;
  value: string;
}

export function splitHeaderValue(raw: string): HeaderValueParts {
  let commentIndex = -1;

  for (let index = raw.indexOf('#'); index >= 0; index = raw.indexOf('#', index + 1)) {
    const previous = raw[index - 1];
    if (index === 0 || previous === ' ' || previous === '\t') {
      commentIndex = index;
      break;
    }
  }

  let sourceEnd = raw.length;
  if (commentIndex >= 0) {
    sourceEnd = commentIndex;
    while (sourceEnd > 0 && (raw[sourceEnd - 1] === ' ' || raw[sourceEnd - 1] === '\t')) {
      sourceEnd--;
    }
  }

  const source = raw.slice(0, sourceEnd);
  return { source, value: source.trim() };
}

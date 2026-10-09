import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { Gp78AdapterError, GP78_LIMITS } from './model';

const decoder = new TextDecoder('utf-8', { fatal: true });
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: false,
  allowBooleanAttributes: false,
});

function checkXmlBounds(xml: string): void {
  let depth = 0;
  let nodes = 0;
  for (let i = 0; i < xml.length;) {
    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i + 4);
      if (end < 0) throw new Gp78AdapterError('invalidGpif', 'xml', 'Unterminated XML comment.');
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', i)) {
      const end = xml.indexOf(']]>', i + 9);
      if (end < 0) throw new Gp78AdapterError('invalidGpif', 'xml', 'Unterminated CDATA section.');
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<?', i)) {
      const end = xml.indexOf('?>', i + 2);
      if (end < 0) throw new Gp78AdapterError('invalidGpif', 'xml', 'Unterminated XML processing instruction.');
      i = end + 2;
      continue;
    }
    if (xml[i] !== '<') {
      i++;
      continue;
    }
    if (/^<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml.slice(i, i + 32))) {
      throw new Gp78AdapterError('invalidGpif', 'xml', 'DTD and entity declarations are not supported.');
    }
    if (xml.startsWith('<!', i)) throw new Gp78AdapterError('invalidGpif', 'xml', 'Unsupported XML declaration.');

    let quote = '';
    let end = i + 1;
    for (; end < xml.length; end++) {
      const char = xml[end];
      if (quote) {
        if (char === quote) quote = '';
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '>') {
        break;
      }
    }
    if (end >= xml.length || quote) throw new Gp78AdapterError('invalidGpif', 'xml', 'Malformed XML tag.');
    const tag = xml.slice(i + 1, end).trim();
    const closing = tag.startsWith('/');
    const selfClosing = tag.endsWith('/');
    if (closing) {
      depth--;
      if (depth < 0) throw new Gp78AdapterError('invalidGpif', 'xml', 'XML element nesting is malformed.');
    } else {
      nodes++;
      if (nodes > GP78_LIMITS.xmlNodes) throw new Gp78AdapterError('resourceLimit', 'xml.nodes', `XML exceeds ${GP78_LIMITS.xmlNodes} elements.`);
      if (!selfClosing) {
        depth++;
        if (depth > GP78_LIMITS.xmlDepth) throw new Gp78AdapterError('resourceLimit', 'xml.depth', `XML nesting exceeds ${GP78_LIMITS.xmlDepth} levels.`);
      }
    }
    i = end + 1;
  }
  if (depth !== 0) throw new Gp78AdapterError('invalidGpif', 'xml', 'XML element nesting is incomplete.');
}

function rejectUnknownEntities(xml: string): void {
  const text = xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g, '');
  const refs = text.match(/&(?:#(?:x[0-9a-fA-F]+|[0-9]+)|[A-Za-z][A-Za-z0-9._-]*);/g) ?? [];
  for (const ref of refs) {
    if (/^&#(?:x[0-9a-fA-F]+|[0-9]+);$/.test(ref)) continue;
    if (!['&amp;', '&lt;', '&gt;', '&apos;', '&quot;'].includes(ref)) {
      throw new Gp78AdapterError('invalidGpif', 'xml.entity', 'Only the five predefined XML entities and numeric references are supported.');
    }
  }
}

export function decodeXmlText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/&(?:#(x[0-9a-fA-F]+|[0-9]+)|(amp|lt|gt|apos|quot));/g, (full, numeric: string | undefined, name: string | undefined) => {
    if (numeric !== undefined) {
      const number = numeric[0].toLowerCase() === 'x' ? Number.parseInt(numeric.slice(1), 16) : Number.parseInt(numeric, 10);
      if (!Number.isInteger(number) || number <= 0 || number > 0x10ffff || (number >= 0xd800 && number <= 0xdfff)) {
        throw new Gp78AdapterError('invalidGpif', 'xml.entity', 'Invalid numeric XML character reference.');
      }
      return String.fromCodePoint(number);
    }
    switch (name) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'apos': return "'";
      case 'quot': return '"';
      default: return full;
    }
  });
}

export function parseGpif(bytes: Uint8Array): Record<string, unknown> {
  let xml: string;
  try {
    xml = decoder.decode(bytes);
  } catch {
    throw new Gp78AdapterError('invalidGpif', 'xml', 'GPIF is not valid UTF-8.');
  }
  checkXmlBounds(xml);
  rejectUnknownEntities(xml);
  const validation = XMLValidator.validate(xml, { allowBooleanAttributes: false });
  if (validation !== true) throw new Gp78AdapterError('invalidGpif', 'xml', `Malformed GPIF XML: ${validation.err.msg}.`);
  try {
    const parsed = parser.parse(xml) as Record<string, unknown>;
    const root = parsed.GPIF;
    if (!root || typeof root !== 'object' || Array.isArray(root)) throw new Error('GPIF root element is missing');
    return root as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Gp78AdapterError) throw error;
    throw new Gp78AdapterError('invalidGpif', 'xml', error instanceof Error ? error.message : 'GPIF XML could not be parsed.');
  }
}

export function xmlList(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function xmlChild(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

export function xmlAttr(value: unknown, key: string): string | undefined {
  const attr = xmlChild(value, `@_${key}`);
  return typeof attr === 'string' ? decodeXmlText(attr) : undefined;
}

export function xmlText(value: unknown): string {
  if (typeof value === 'string') return decodeXmlText(value).trim();
  return decodeXmlText(xmlChild(value, '#text')).trim();
}

export function xmlChildren(value: unknown, key: string): unknown[] {
  return xmlList(xmlChild(value, key));
}

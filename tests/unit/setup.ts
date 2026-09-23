import Module from 'module';

const mockVscode = {
  SymbolKind: {
    File: 0,
    Module: 1,
    Namespace: 2,
    Package: 3,
    Class: 4,
    Method: 5,
    Property: 6,
    Field: 7,
    Constructor: 8,
    Enum: 9,
    Interface: 10,
    Function: 11,
    Variable: 12,
    Constant: 13,
    String: 14,
    Number: 15,
    Boolean: 16,
    Array: 17,
    Object: 18,
    Key: 19,
    Null: 20,
    EnumMember: 21,
    Struct: 22,
    Event: 23,
    Operator: 24,
    TypeParameter: 25
  },
  Range: class {
    constructor(public start: any, public end: any) {}
  },
  Position: class {
    constructor(public line: number, public character: number) {}
  },
  DocumentSymbol: class {
    children: any[] = [];
    constructor(
      public name: string,
      public detail: string,
      public kind: any,
      public range: any,
      public selectionRange: any
    ) {}
  }
};

// @ts-ignore
const origRequire = Module.prototype.require;
// @ts-ignore
Module.prototype.require = function (id: string, ...args: any[]) {
  if (id === 'vscode') {
    return mockVscode;
  }
  return origRequire.call(this, id, ...args);
};

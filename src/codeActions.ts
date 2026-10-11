/** Public Code Action exports; implementations are grouped by concern in ./codeActions/. */
export { planMusicCodeAction, codeActionSelectionCanTransform } from './codeActions/planners';
export type { MusicCodeAction } from './codeActions/planners';
export { computeCodeActionHints } from './codeActions/analysis';
export type { CodeActionHint } from './codeActions/analysis';
export type { MusicCodeActionPlan, MusicCodeActionFailure, SourceSelection } from './codeActions/sourceIndex';

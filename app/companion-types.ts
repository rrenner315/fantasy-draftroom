export type CompanionPlayer = { id: string; name: string; position: string; team: string; rank: number; source: string; sourceRank: number; tier: number | null; byeWeek?: number | null };
export type CompanionPick = CompanionPlayer & { pick: number; roster: number; skipped?: boolean };
export type CompanionSnapshot = { draftId: string; name: string; teams: number; snake: boolean; mySlot: number; teamNames: Record<string, string>; players: CompanionPlayer[]; picks: CompanionPick[]; locked: boolean; active: boolean; saveStatus: string };
export type PickAction = { kind: 'pick' | 'undo' | 'skip'; revision: string; playerId?: string; fillPick?: number };
export type CompanionMessage = { channel: 'draft-companion'; type: 'hello' | 'command' | 'snapshot'; requestId?: string; action?: PickAction; snapshot?: CompanionSnapshot; error?: string };
export type CompanionBridge = {
  openCompanion: () => Promise<void>;
  sendCompanionMessage: (message: CompanionMessage) => void;
  onCompanionMessage: (callback: (message: CompanionMessage) => void) => () => void;
};

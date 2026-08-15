// Module-level mutable ref. Store actions write to `.current` right before
// mutating state; useCardMoveFlip reads and clears it after React re-renders.
export const flipBridge = { current: null };

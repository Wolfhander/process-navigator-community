export const MAX_PROCESS_LEVEL = 20;

// Offer the next level without filling selectors with every possible depth.
export const processLevelOptions = (highestKnownLevel: number): number[] => {
  const highest = Math.min(MAX_PROCESS_LEVEL, Math.max(4, highestKnownLevel + 1));
  return Array.from({ length: highest + 1 }, (_, level) => level);
};
